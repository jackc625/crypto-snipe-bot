// dashboard/src/components/anti-rug/AntiRugExitDetailModal.tsx
// Phase 19 / Plan 19-06 — Read-only evidence modal for an anti-rug exit.
//
// Opens via:
//   - AntiRugStateBadge click in the positions table
//   - Last-10-events row click in the AntiRugMonitorTile
//
// 3 content variants per UI-SPEC §"Anti-Rug Exit detail modal":
//   - live: full tx artifacts (tx hash, block, sell amount, ETH received, gas
//     multiplier, ROI vs entry)
//   - dry-run: "Dry-run only — no transaction submitted" empty-state copy
//   - pending-confirm: "Exit pending confirmation" empty-state copy
//
// Read-only — no confirm button. ESC + backdrop click close. Tx-hash row is
// click-to-copy with a 2-second `Copied!` toast.
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Anti-Rug Exit detail modal" (copy + variant table)
//   - dashboard/src/components/ConfirmDialog.tsx — backdrop pattern, but
//     wider (w-[640px]) shell and no confirm button

import { useState } from 'react';
import type { RugSignals } from '../../types/api';
import { formatAddress } from '../../utils/formatters';

interface AntiRugExitDetailModalProps {
  open: boolean;
  variant: 'live' | 'dry-run' | 'pending-confirm';
  tokenSymbol: string;
  chain: string;
  signals?: RugSignals;
  // live-variant artifacts
  txHash?: string;
  block?: number;
  sellAmount?: string;
  ethReceived?: string;
  gasMultiplier?: number;
  roiVsEntry?: number;
  // CR-06-FOLLOWUP (iter-2): live-exit success/failure flag from the
  // wire payload's `AntiRugStateUpdate.success`. Only meaningful when
  // `variant === 'live'`; ignored otherwise.
  //   - `true`  → green success banner above the tx-artifacts block
  //   - `false` → red failure banner ("position still open, trigger
  //               slot consumed") above the tx-artifacts block
  //   - undefined → no banner (older positions in flight before the
  //                 iter-2 wire change landed)
  success?: boolean;
  // pending-confirm artifact
  confirmBlocksRemaining?: number;
  // explorer
  explorerUrl?: string;
  onDismiss: () => void;
}

export function AntiRugExitDetailModal({
  open,
  variant,
  tokenSymbol,
  chain,
  signals,
  txHash,
  block,
  sellAmount,
  ethReceived,
  gasMultiplier,
  roiVsEntry,
  success,
  confirmBlocksRemaining,
  explorerUrl,
  onDismiss,
}: AntiRugExitDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopyTxHash = () => {
    if (!txHash) return;
    try {
      navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable -- best-effort
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-surface/70" onClick={onDismiss} />

      <div className="relative bg-surface-light rounded-lg p-6 w-[640px] max-h-[80vh] overflow-y-auto border border-border shadow-xl">
        <h2 className="text-xl font-bold leading-[1.2]">
          Anti-Rug Exit — {tokenSymbol} on {chain.toUpperCase()}
        </h2>

        {/* Signals fired — always rendered when signals provided */}
        {signals && (
          <div className="mt-4">
            <h3 className="text-sm font-bold mb-2">Signals fired</h3>
            <div className="bg-surface rounded p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-xs text-text-muted">LP removed</span>
                <span className="font-mono">{signals.lpRemovedPct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-text-muted">Destination address</span>
                <span className="font-mono">{formatAddress(signals.destination)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-text-muted">Allowlist check</span>
                <span>{signals.allowlistHit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-text-muted">Sell-sim slippage</span>
                <span className="font-mono">
                  {signals.sellSimSlippagePct ?? signals.v2ReservePctBelow ?? 'n/a'}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* CR-06-FOLLOWUP (iter-2): live-exit success/failure banner.
            Rendered above the tx-artifacts block when variant === 'live'
            AND the wire payload included a `success` boolean. Operator
            can now distinguish a confirmed live exit from a failed one
            at-a-glance — the failed case is the more operationally-
            important signal (position still open, trigger slot
            consumed, CB one step closer to tripping). */}
        {variant === 'live' && success === true && (
          <div className="mt-4 border-l-2 border-profit bg-surface rounded-r px-3 py-3">
            <p className="text-sm text-profit">
              <span className="font-bold">EXIT SUCCEEDED</span> — executeFullSell returned true on {chain.toUpperCase()}. The position is closed; see the tx artifacts below for the receipt.
            </p>
          </div>
        )}
        {variant === 'live' && success === false && (
          <div className="mt-4 border-l-2 border-loss bg-surface rounded-r px-3 py-3">
            <p className="text-sm text-loss">
              <span className="font-bold">EXIT FAILED</span> — executeFullSell returned false on {chain.toUpperCase()}. The position is still open AND a trigger slot was consumed (circuit breaker is one step closer to tripping). Review the bot logs and consider a manual Force Sell.
            </p>
          </div>
        )}

        {/* Variant-specific content */}
        {variant === 'live' && txHash && (
          <div className="mt-4">
            <h3 className="text-sm font-bold mb-2">Exit transaction</h3>
            <div className="bg-surface rounded p-3 space-y-1 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-muted">Tx hash</span>
                <button
                  onClick={handleCopyTxHash}
                  className="font-mono text-right hover:underline"
                  title="Click to copy"
                >
                  {formatAddress(txHash)}
                </button>
                {copied && (
                  <span className="text-profit text-xs ml-2">Copied!</span>
                )}
              </div>
              {block !== undefined && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">Block</span>
                  <span className="font-mono">{block}</span>
                </div>
              )}
              {sellAmount && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">Sell amount</span>
                  <span className="font-mono">{sellAmount}</span>
                </div>
              )}
              {ethReceived && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">ETH received</span>
                  <span className="font-mono">{ethReceived}</span>
                </div>
              )}
              {gasMultiplier !== undefined && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">Gas multiplier</span>
                  <span className="font-mono">{gasMultiplier.toFixed(2)}×</span>
                </div>
              )}
              {roiVsEntry !== undefined && (
                <div className="flex justify-between">
                  <span className="text-xs text-text-muted">ROI vs entry</span>
                  <span className="font-mono">{roiVsEntry.toFixed(2)}%</span>
                </div>
              )}
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-accent underline text-xs mt-2"
                >
                  View on Etherscan
                </a>
              )}
            </div>
          </div>
        )}

        {variant === 'dry-run' && (
          <div className="mt-4 border-l-2 border-warning bg-surface rounded-r px-3 py-3">
            <p className="text-sm text-warning">
              Dry-run only — no transaction submitted. This panel shows what the bot WOULD have executed had {chain.toUpperCase()}_ANTIRUG_LIVE_EXECUTE been set to true.
            </p>
          </div>
        )}

        {variant === 'pending-confirm' && (
          <div className="mt-4 border-l-2 border-info bg-surface rounded-r px-3 py-3">
            <p className="text-sm text-text">
              Exit pending confirmation. The bot has detected a confirmed rug signal and will submit the exit transaction after {confirmBlocksRemaining ?? '?'} blocks of confirmation delay.
            </p>
          </div>
        )}

        {/* Footer — no confirm button, only Close */}
        <div className="flex justify-end mt-6">
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded text-sm bg-surface-lighter text-text-muted hover:text-text transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
