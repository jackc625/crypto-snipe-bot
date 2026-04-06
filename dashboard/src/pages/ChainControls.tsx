import { useState } from 'react';
import type { ChainStatus } from '../types/api';
import { ChainStatusCard } from '../components/ChainStatusCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmergencyConfirmDialog } from '../components/EmergencyConfirmDialog';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';

interface ChainsResponse {
  chains: ChainStatus[];
}

type DialogState =
  | { type: 'none' }
  | { type: 'stop'; chain: ChainStatus }
  | { type: 'start'; chain: ChainStatus }
  | { type: 'emergency' };

export function ChainControls() {
  const { data, error, refetch } = useApi<ChainsResponse>('/api/chains');
  const { chainStatuses: wsChainStatuses } = useWebSocket();
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [emergencyError, setEmergencyError] = useState<string | null>(null);
  const [chainWarnings, setChainWarnings] = useState<Record<string, string[]>>({});

  const handleStopConfirm = async () => {
    if (dialog.type !== 'stop') return;
    const chainName = dialog.chain.name;
    setDialog({ type: 'none' });
    setActionError(null);
    setChainWarnings(prev => {
      const next = { ...prev };
      delete next[chainName];
      return next;
    });

    try {
      const res = await fetch(`/api/chains/${chainName}/stop`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || 'Unknown error');
      }
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setActionError(`Failed to stop ${chainName}: ${message}. Check RPC configuration.`);
    }
  };

  const handleStartConfirm = async () => {
    if (dialog.type !== 'start') return;
    const chainName = dialog.chain.name;
    setDialog({ type: 'none' });
    setActionError(null);
    setChainWarnings(prev => {
      const next = { ...prev };
      delete next[chainName];
      return next;
    });

    try {
      const res = await fetch(`/api/chains/${chainName}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || 'Unknown error');
      }
      const data = await res.json();
      if (data.warnings?.length > 0) {
        setChainWarnings(prev => ({ ...prev, [chainName]: data.warnings }));
      }
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setActionError(`Failed to start ${chainName}: ${message}. Check RPC configuration.`);
    }
  };

  const handleEmergencySell = async () => {
    setDialog({ type: 'none' });
    setEmergencyError(null);

    try {
      const res = await fetch('/api/controls/emergency-sell', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(body.error || 'Unknown error');
      }
      const result = await res.json();
      if (result.failed > 0) {
        setEmergencyError(
          `Emergency sell encountered errors. ${result.failed} of ${result.sold + result.failed} positions may not have been sold. Check the bot logs immediately.`
        );
      }
      refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setEmergencyError(
        `Emergency sell encountered errors. ${message}. Check the bot logs immediately.`
      );
    }
  };

  // D-09: Prefer WS-pushed chain data for real-time updates.
  // D-11: useApi provides initial REST load; WS provides real-time updates after hydration.
  const chains = wsChainStatuses.length > 0 ? wsChainStatuses : (data?.chains || []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold leading-[1.2]">Chain Controls</h1>
        <button
          onClick={() => setDialog({ type: 'emergency' })}
          className="px-6 py-3 rounded text-sm font-bold bg-loss text-white hover:opacity-90 transition-colors"
        >
          Emergency Sell All
        </button>
      </div>

      {/* Error banners */}
      {error && (
        <div className="p-4 mb-4 border-l-4 border-loss bg-surface-light rounded">
          <p className="text-sm text-text">{error}</p>
        </div>
      )}
      {actionError && (
        <div className="p-4 mb-4 border-l-4 border-loss bg-surface-light rounded">
          <p className="text-sm text-text">{actionError}</p>
        </div>
      )}
      {emergencyError && (
        <div className="p-4 mb-4 border-l-4 border-loss bg-surface-light rounded">
          <p className="text-sm text-text">{emergencyError}</p>
        </div>
      )}

      {/* Chain cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {chains.map((chain) => (
          <ChainStatusCard
            key={chain.name}
            chain={chain}
            onStop={() => setDialog({ type: 'stop', chain })}
            onStart={() => setDialog({ type: 'start', chain })}
            warnings={chainWarnings[chain.name]}
            onDismissWarnings={() => setChainWarnings(prev => {
              const next = { ...prev };
              delete next[chain.name];
              return next;
            })}
          />
        ))}
      </div>

      {chains.length === 0 && !error && (
        <div className="text-center py-16">
          <p className="text-text-muted">No chains configured. Check bot configuration.</p>
        </div>
      )}

      {/* Stop confirmation dialog */}
      {dialog.type === 'stop' && (
        <ConfirmDialog
          open={true}
          title={`Stop ${dialog.chain.displayName}?`}
          body="New pair and pool listeners will stop. Existing positions will continue being monitored by the exit engine."
          confirmLabel={`Stop ${dialog.chain.displayName}`}
          dismissLabel="Keep Running"
          variant="destructive"
          onConfirm={handleStopConfirm}
          onDismiss={() => setDialog({ type: 'none' })}
        />
      )}

      {/* Start confirmation dialog */}
      {dialog.type === 'start' && (
        <ConfirmDialog
          open={true}
          title={`Start ${dialog.chain.displayName}?`}
          body={`This will resume listening for new pairs and pools on ${dialog.chain.displayName}.`}
          confirmLabel={`Start ${dialog.chain.displayName}`}
          dismissLabel="Keep Stopped"
          variant="neutral"
          onConfirm={handleStartConfirm}
          onDismiss={() => setDialog({ type: 'none' })}
        />
      )}

      {/* Emergency sell dialog */}
      <EmergencyConfirmDialog
        open={dialog.type === 'emergency'}
        onConfirm={handleEmergencySell}
        onDismiss={() => setDialog({ type: 'none' })}
      />
    </div>
  );
}
