import { useState, useEffect, useRef, useCallback } from 'react';
import type { Position, NotificationEvent, WsEvent, ChainStatus } from '../types/api';

interface UseWebSocketResult {
  connected: boolean;
  lastMessage: WsEvent<unknown> | null;
  positions: Position[];
  notifications: NotificationEvent[];
  chainStatuses: ChainStatus[];
}

/**
 * Custom hook for WebSocket connection with auto-reconnect.
 * Connects to ws://{host}/ws and handles typed events:
 * - positions_update: updates positions state
 * - notification: prepends to notifications (capped at 100 per D-10)
 * - chain_status_change: updates chain status state
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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshFromRest = useCallback(async () => {
    try {
      const [posRes, chainRes] = await Promise.all([
        fetch('/api/positions', { credentials: 'include' }),
        fetch('/api/chains', { credentials: 'include' }),
      ]);
      if (posRes.ok) {
        const posData = await posRes.json();
        setPositions(posData.positions || []);
      }
      if (chainRes.ok) {
        const chainData = await chainRes.json();
        setChainStatuses(chainData.chains || []);
      }
    } catch {
      // REST refresh failed silently -- WebSocket push will deliver state
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

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
        }
      } catch {
        // Ignore malformed messages
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

  return { connected, lastMessage, positions, notifications, chainStatuses };
}
