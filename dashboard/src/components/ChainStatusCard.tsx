import type { ChainStatus } from '../types/api';
import { StatusDot } from './StatusDot';

interface ChainStatusCardProps {
  chain: ChainStatus;
  onStop: () => void;
  onStart: () => void;
}

const statusLabels: Record<string, string> = {
  running: 'Running',
  stopped: 'Stopped',
  disconnected: 'Disconnected',
};

function maskRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `RPC: ${parsed.hostname}`;
  } catch {
    return 'RPC: --';
  }
}

export function ChainStatusCard({ chain, onStop, onStart }: ChainStatusCardProps) {
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

      {/* Config sections */}
      <div className="space-y-3 text-sm">
        {/* Snipe Parameters */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Snipe Parameters</h4>
          <div className="space-y-0.5">
            <ConfigRow label="Snipe Amount" value={chain.config.snipeAmount} />
            <ConfigRow label="Max Capital" value={chain.config.maxCapital} />
          </div>
        </div>

        {/* Risk Limits */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Risk Limits</h4>
          <div className="space-y-0.5">
            <ConfigRow label="DEXes" value={chain.config.dexes.join(', ')} />
          </div>
        </div>

        {/* Exit Strategy */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Exit Strategy</h4>
          <div className="space-y-0.5">
            <ConfigRow label="Chain ID" value={String(chain.config.chainId)} />
          </div>
        </div>

        {/* Connection Status */}
        <div>
          <h4 className="text-xs text-text-muted font-bold mb-1">Connection Status</h4>
          <div className="space-y-0.5">
            <ConfigRow label="RPC" value={maskRpcUrl(chain.config.rpcUrl)} />
            <ConfigRow
              label="WebSocket"
              value={chain.config.wsConnected ? 'Connected' : 'Disconnected'}
            />
            <ConfigRow
              label="Latest Block"
              value={chain.config.latestBlock !== null ? String(chain.config.latestBlock) : '--'}
            />
            <ConfigRow label="Chain ID" value={String(chain.config.chainId)} />
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
