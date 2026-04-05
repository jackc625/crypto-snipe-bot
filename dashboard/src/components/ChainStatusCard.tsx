import type { ChainStatus } from '../types/api';
import { StatusDot } from './StatusDot';

interface ChainStatusCardProps {
  chain: ChainStatus;
  onStop: () => void;
  onStart: () => void;
  warnings?: string[];            // D-12: restart warnings from backend
  onDismissWarnings?: () => void;  // Dismiss handler for warning banner
}

const statusLabels: Record<string, string> = {
  running: 'Running',
  stopped: 'Stopped',
  disconnected: 'Disconnected',
};

export function ChainStatusCard({ chain, onStop, onStart, warnings, onDismissWarnings }: ChainStatusCardProps) {
  const status = chain.status;

  return (
    <div className="bg-surface-light rounded-lg border border-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <h3 className="text-xl font-bold leading-[1.2]">{chain.displayName}</h3>
        </div>
        <span className="text-xs text-text-muted">{statusLabels[status] || status}</span>
      </div>

      {/* Action button */}
      <div className="mb-4">
        {status === 'running' && (
          <button
            onClick={onStop}
            className="w-full px-4 py-2 rounded text-sm bg-loss text-white hover:opacity-90 transition-colors"
          >
            Stop Listening
          </button>
        )}
        {status === 'stopped' && (
          <button
            onClick={onStart}
            className="w-full px-4 py-2 rounded text-sm bg-accent text-white hover:opacity-90 transition-colors"
          >
            Start Listening
          </button>
        )}
        {status === 'disconnected' && (
          <button
            disabled
            className="w-full px-4 py-2 rounded text-sm bg-surface-lighter text-text-disabled cursor-not-allowed"
          >
            Disconnected
          </button>
        )}
      </div>

      {/* Restart warnings banner (D-12) */}
      {warnings && warnings.length > 0 && (
        <div className="border-l-2 border-warning bg-surface rounded-r-lg px-4 py-3 mb-4 relative">
          {onDismissWarnings && (
            <button
              onClick={onDismissWarnings}
              className="absolute top-2 right-2 text-text-muted hover:text-text transition-colors"
              aria-label="Dismiss warnings"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-warning">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Config sections */}
      <div className="space-y-3 text-sm">
        {/* Snipe Parameters */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Snipe Parameters</h4>
          <div className="space-y-0.5">
            <ConfigRow label="Snipe Amount" value={chain.snipeParams.snipeAmount} />
            <ConfigRow label="Max Capital" value={chain.snipeParams.maxCapital} />
            <ConfigRow label="Min Liquidity" value={chain.snipeParams.minLiquidity} />
          </div>
        </div>

        {/* Risk Limits */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Risk Limits</h4>
          <div className="space-y-0.5">
            <ConfigRow label="Max Open Positions" value={chain.riskLimits.maxOpenPositions} />
            <ConfigRow label="Max Exposure" value={chain.riskLimits.maxTotalExposure} />
            <ConfigRow label="Daily Loss %" value={chain.riskLimits.dailyLossPct} />
          </div>
        </div>

        {/* Exit Strategy */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Exit Strategy</h4>
          <div className="space-y-0.5">
            <ConfigRow label="Trailing Stop" value={`${chain.exitStrategy.trailingStopPct}%`} />
            <ConfigRow label="Stop Loss" value={`${chain.exitStrategy.stopLossPct}%`} />
          </div>
        </div>

        {/* Connection Status */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Connection Status</h4>
          <div className="space-y-0.5">
            <ConfigRow label="RPC" value={`RPC: ${chain.connection.rpcUrl}`} />
            <ConfigRow
              label="WebSocket"
              value={chain.wsConnected ? 'Connected' : 'Disconnected'}
            />
            <ConfigRow
              label="Latest Block"
              value={chain.connection.lastBlock !== null ? String(chain.connection.lastBlock) : '--'}
            />
            <ConfigRow label="Chain ID" value={String(chain.connection.chainId)} />
          </div>
        </div>

        {/* DEXes */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">DEXes</h4>
          <div className="space-y-0.5">
            <ConfigRow label="Active" value={chain.dexes.join(', ') || '--'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}
