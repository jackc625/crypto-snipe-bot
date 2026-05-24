// dashboard/src/components/anti-rug/WsHealthIndicator.tsx
// Phase 19 / Plan 19-06 — Per-chain WebSocket health indicator (🟢/🟡/🔴).
//
// Rendered:
//   (a) in the sidebar footer next to the existing global WS dot, one per
//       enabled chain
//   (b) in each ChainStatusCard's WebSocket row (Plan 19-06 extends the
//       existing wsConnected boolean string with this 3-state indicator).
//
// Tooltip is the entire interactive surface — UI-SPEC §"Per-chain WS-health
// indicator" verbatim per-state copy.
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Per-chain WS-health indicator" (verbatim tooltip copy)
//   - dashboard/src/components/StatusDot.tsx — semantic palette
//   - dashboard/src/components/Sidebar.tsx:49-77 — sidebar footer pattern

import { StatusDot } from '../StatusDot';
import { formatTimeAgo } from '../../utils/formatters';

interface WsHealthIndicatorProps {
  chain: string;
  state: 'connected' | 'reconnecting' | 'disconnected';
  /** Last successful pong timestamp (ms). For 'connected' + 'reconnecting' tooltips. */
  lastPongTs?: number;
  /** How long the connection has been disconnected (seconds). For 'disconnected' tooltip. */
  disconnectedDurationSec?: number;
  /** Optional inline label (renders next to the dot in expanded layouts). */
  showLabel?: boolean;
}

function buildTooltip(
  state: 'connected' | 'reconnecting' | 'disconnected',
  chain: string,
  lastPongTs?: number,
  disconnectedDurationSec?: number,
): string {
  const upper = chain.toUpperCase();
  if (state === 'connected') {
    const ago = lastPongTs ? formatTimeAgo(lastPongTs) : 'unknown';
    return `WebSocket connected to ${upper}. Last heartbeat ${ago}.`;
  }
  if (state === 'reconnecting') {
    const ago = lastPongTs ? formatTimeAgo(lastPongTs) : 'unknown';
    return `WebSocket reconnecting to ${upper}. Last seen ${ago}.`;
  }
  // disconnected
  const dur = disconnectedDurationSec
    ? disconnectedDurationSec < 60
      ? `${disconnectedDurationSec}s`
      : `${Math.floor(disconnectedDurationSec / 60)}m`
    : 'unknown duration';
  return `WebSocket disconnected from ${upper} for ${dur}. Anti-rug events on this chain may be delayed until reconnect.`;
}

const stateLabels: Record<WsHealthIndicatorProps['state'], string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

export function WsHealthIndicator({
  chain,
  state,
  lastPongTs,
  disconnectedDurationSec,
  showLabel = false,
}: WsHealthIndicatorProps) {
  const tooltip = buildTooltip(state, chain, lastPongTs, disconnectedDurationSec);
  // UI-SPEC §Color: 🟡 reconnecting uses warning yellow, not accent.
  // StatusDot exposes connected (green animate-pulse), reconnecting (bg-loss
  // currently — but UI-SPEC §"Per-chain WS-health indicator" requires
  // yellow), disconnected (red). Render an inline span when reconnecting to
  // hit the yellow per UI-SPEC requirement.
  return (
    <span className="inline-flex items-center gap-2" title={tooltip}>
      {state === 'reconnecting' ? (
        <span
          className="inline-block w-2 h-2 rounded-full bg-warning"
          role="status"
          aria-label="reconnecting"
        />
      ) : (
        <StatusDot status={state} />
      )}
      {showLabel && (
        <span className="text-xs text-text-muted">
          {chain.toUpperCase()}: {stateLabels[state]}
        </span>
      )}
    </span>
  );
}
