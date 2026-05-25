import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  Position,
  NotificationEvent,
  WsEvent,
  ChainStatus,
  AntiRugEvent,
  AntiRugStateUpdate,
  ChainWsHealthChange,
  CbTrippedPayload,
  CbResetPayload,
  PauseState,
  PauseStateChangePayload,
} from '../types/api';

interface UseWebSocketResult {
  connected: boolean;
  lastMessage: WsEvent<unknown> | null;
  positions: Position[];
  notifications: NotificationEvent[];
  chainStatuses: ChainStatus[];
  // Phase 19 / Plan 19-06 — anti-rug push state
  antiRugEvents: Record<string, AntiRugEvent[]>;
  chainWsHealth: Record<string, ChainWsHealthChange>;
  circuitBreakerTrips: Record<string, CbTrippedPayload>;
  // Phase 20 / Plan 20-06 — global pause-state push (D-PAUSE-UI)
  pauseState: PauseState | null;
}

/**
 * Custom hook for WebSocket connection with auto-reconnect.
 * Connects to ws://{host}/ws and handles typed events:
 * - positions_update: updates positions state
 * - notification: prepends to notifications (capped at 100 per D-10)
 * - chain_status_change: updates chain status state
 *
 * Phase 19 additions (Plan 19-06 — per UI-SPEC §"Realtime Push Contract"):
 * - antirug_state_update: merges state + lastSignals into matching Position by tradeId
 * - antirug_event: prepends to per-chain last-100 events list; handles gap-detected
 * - chain_ws_health_change: updates per-chain WS health map (drives 🟢/🟡/🔴 indicator)
 * - cb_tripped: adds chain to circuitBreakerTrips (drives CircuitBreakerBanner + modal)
 * - cb_reset: removes chain from circuitBreakerTrips
 *
 * Auto-reconnects with 3-second delay on disconnect.
 * On reconnect, triggers REST refresh of positions and chain status.
 */
export function useWebSocket(): UseWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsEvent<unknown> | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [chainStatuses, setChainStatuses] = useState<ChainStatus[]>([]);
  // Phase 19 — anti-rug push state
  const [antiRugEvents, setAntiRugEvents] = useState<Record<string, AntiRugEvent[]>>({});
  const [chainWsHealth, setChainWsHealth] = useState<Record<string, ChainWsHealthChange>>({});
  const [circuitBreakerTrips, setCircuitBreakerTrips] = useState<Record<string, CbTrippedPayload>>({});
  // Phase 20 / Plan 20-06 — global pause-state push (D-PAUSE-UI)
  const [pauseState, setPauseState] = useState<PauseState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshFromRest = useCallback(async () => {
    try {
      // Phase 20 / Plan 20-06 — also hydrate pause-state on connect/reconnect.
      // Per RESEARCH §Pitfall 5 + T-20-W6-02 mitigation: re-fetch on reconnect
      // ensures banner reconciles to authoritative server state within one
      // reconnect cycle (in case a pause_state_change event was missed
      // mid-disconnect).
      const [posRes, chainRes, pauseRes] = await Promise.all([
        fetch('/api/positions', { credentials: 'include' }),
        fetch('/api/chains', { credentials: 'include' }),
        fetch('/api/controls/pause', { credentials: 'include' }),
      ]);
      if (posRes.ok) {
        const posData = await posRes.json();
        setPositions(posData.positions || []);
      }
      if (chainRes.ok) {
        const chainData = await chainRes.json();
        setChainStatuses(chainData.chains || []);
      }
      if (pauseRes.ok) {
        const pauseData = await pauseRes.json() as PauseState;
        // Normalise the GET /api/controls/pause shape to PauseState
        // (controls.ts:GET returns the same shape verbatim per Plan 20-05).
        setPauseState({
          paused: !!pauseData.paused,
          pausedAt: pauseData.pausedAt ?? null,
          pausedBy: pauseData.pausedBy ?? null,
          reason: pauseData.reason ?? null,
        });
      }
    } catch {
      // REST refresh failed silently -- WebSocket push will deliver state
    }
  }, []);

  const connect = useCallback(() => {
    // WR-05: bail if the previous socket is OPEN or CONNECTING. The
    // original short-circuit only checked OPEN — when the reconnect
    // timer fired while the previous CONNECTING socket was still
    // negotiating, we created a second socket, overwrote wsRef.current,
    // and dangled the previous one. The old socket would finish
    // negotiation, attach its onopen/onclose handlers (which schedule
    // ANOTHER reconnect on close), and the orphaned-sockets count would
    // grow over time in a long-running dashboard tab. With two live
    // sockets both attached to onmessage, positions_update and
    // antirug_event would also be duplicated into state.
    if (
      wsRef.current &&
      wsRef.current.readyState !== WebSocket.CLOSED &&
      wsRef.current.readyState !== WebSocket.CLOSING
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Refresh state from REST on connect/reconnect
      refreshFromRest();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsEvent<unknown>;
        setLastMessage(msg);

        switch (msg.type) {
          case 'positions_update': {
            const data = msg.data as { positions: Position[] };
            setPositions(data.positions || []);
            break;
          }
          case 'notification': {
            const notif = msg.data as NotificationEvent;
            const enriched: NotificationEvent = {
              ...notif,
              timestamp: notif.timestamp || msg.timestamp,
            };
            setNotifications((prev) => [enriched, ...prev].slice(0, 100));
            break;
          }
          case 'chain_status_change': {
            const data = msg.data as { chains: ChainStatus[] };
            setChainStatuses(data.chains || []);
            break;
          }
          // ─────────────────────────────────────────────────────────────────
          // Phase 19 / Plan 19-06 — Anti-Rug push event dispatch
          // ─────────────────────────────────────────────────────────────────
          case 'antirug_state_update': {
            // Defensive narrowing per threat T-19-06-06: never throw on parse failure.
            try {
              const update = msg.data as AntiRugStateUpdate;
              if (!update || typeof update.tradeId !== 'number') break;
              // CR-06: normalise `lastSignals: null` (from the
              // 'unknown'-verdict variant of RugEvaluation) to
              // `undefined` so downstream consumers can use simple
              // `if (signals)` checks without worrying about null being
              // a truthy object (e.g. the AntiRugExitDetailModal would
              // otherwise render an empty signals panel instead of the
              // 'no signals available' fallback).
              const lastSignals = update.lastSignals ?? undefined;
              // CR-06-FOLLOWUP (iter-2): the wire payload's `success`
              // boolean was being silently dropped — only `state`,
              // `lastEventTs`, and `lastSignals` were destructured into
              // the Position row. Capturing it into the new
              // `antiRugLastSuccess` field lets AntiRugStateBadge and
              // AntiRugExitDetailModal differentiate
              // `exit-fired-success` from `exit-fired-failure` on the
              // dashboard (the most operationally-important signal
              // before live-execute graduation).
              setPositions((prev) =>
                prev.map((p) =>
                  p.tradeId === update.tradeId
                    ? {
                        ...p,
                        antiRugState: update.state,
                        antiRugLastEventTs: update.lastEventTs,
                        antiRugLastSignals: lastSignals,
                        antiRugLastSuccess: update.success,
                      }
                    : p,
                ),
              );
            } catch (err) {
              // WR-09: log to DevTools so malformed payload regressions are
              // visible (still doesn't break dispatch).
              console.warn('[WS] antirug_state_update: malformed payload', err);
            }
            break;
          }
          case 'antirug_event': {
            try {
              const evt = msg.data as AntiRugEvent;
              if (!evt || typeof evt.chain !== 'string') break;
              setAntiRugEvents((prev) => {
                const existing = prev[evt.chain] ?? [];
                return {
                  ...prev,
                  // Prepend newest, cap at 100 per-chain (matches notification cap)
                  [evt.chain]: [evt, ...existing].slice(0, 100),
                };
              });
            } catch (err) {
              console.warn('[WS] antirug_event: malformed payload', err);
            }
            break;
          }
          case 'chain_ws_health_change': {
            try {
              const health = msg.data as ChainWsHealthChange;
              if (!health || typeof health.chain !== 'string') break;
              setChainWsHealth((prev) => ({ ...prev, [health.chain]: health }));
            } catch (err) {
              console.warn('[WS] chain_ws_health_change: malformed payload', err);
            }
            break;
          }
          case 'cb_tripped': {
            try {
              const trip = msg.data as CbTrippedPayload;
              if (!trip || typeof trip.chain !== 'string') break;
              setCircuitBreakerTrips((prev) => ({ ...prev, [trip.chain]: trip }));
            } catch (err) {
              console.warn('[WS] cb_tripped: malformed payload', err);
            }
            break;
          }
          case 'cb_reset': {
            try {
              const reset = msg.data as CbResetPayload;
              if (!reset || typeof reset.chain !== 'string') break;
              setCircuitBreakerTrips((prev) => {
                // Remove the chain key; per UI-SPEC §CB-banner: if no chains
                // remain tripped, the banner hides automatically.
                const { [reset.chain]: _removed, ...rest } = prev;
                void _removed;
                return rest;
              });
            } catch (err) {
              console.warn('[WS] cb_reset: malformed payload', err);
            }
            break;
          }
          // ─────────────────────────────────────────────────────────────────
          // Phase 20 / Plan 20-06 — Global pause-state push (D-PAUSE-UI)
          // Broadcast sources (Plan 20-04 + 20-05):
          //   - bot mid-run wallet-undercut setInterval (src/bot.ts)
          //   - POST /api/controls/pause (src/api/routes/controls.ts)
          //   - POST /api/controls/resume (src/api/routes/controls.ts)
          // Defensive narrowing per T-19-06-06 carry-forward: never throw on parse failure.
          // ─────────────────────────────────────────────────────────────────
          case 'pause_state_change': {
            try {
              const payload = msg.data as PauseStateChangePayload;
              if (!payload || typeof payload.paused !== 'boolean') break;
              setPauseState({
                paused: payload.paused,
                pausedAt: payload.pausedAt ?? null,
                pausedBy: payload.pausedBy ?? null,
                reason: payload.reason ?? null,
              });
            } catch (err) {
              console.warn('[WS] pause_state_change: malformed payload', err);
            }
            break;
          }
          default: {
            // WR-09: surface unknown event types (typo / version mismatch
            // between bot and dashboard). Previously fell through silently,
            // making regressions impossible to diagnose.
            console.warn('[WS] unknown event type:', msg.type);
          }
        }
      } catch (err) {
        // WR-09: log JSON.parse failures instead of dropping silently
        console.warn('[WS] failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect with 3-second delay
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }, [refreshFromRest]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    connected,
    lastMessage,
    positions,
    notifications,
    chainStatuses,
    antiRugEvents,
    chainWsHealth,
    circuitBreakerTrips,
    pauseState,
  };
}
