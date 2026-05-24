// dashboard/src/components/anti-rug/CircuitBreakerResetModal.tsx
// Phase 19 / Plan 19-06 — N-acknowledge + RESET-text-gated reset confirmation.
//
// The highest-stakes operator interaction in Phase 19. Flow per UI-SPEC
// §"CB-reset modal flow":
//   1. Modal opens with N trigger sections (N = triggers.length per Warning 11)
//   2. Each section has full evidence + an unchecked `I have reviewed this
//      trigger` checkbox.
//   3. Reset button stays disabled until ALL N checkboxes are checked.
//   4. After all checked, `Type RESET to confirm` input appears.
//   5. Input must match exactly 'RESET' (case-sensitive) for button to enable.
//   6. On click, POST /api/anti-rug/circuit-breaker/{chain}/reset
//   7. Success → close modal (the cb_reset broadcast hides the banner).
//      Failure → inline error rendering, state preserved.
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"CB-reset modal flow" + §"CB-reset modal" (copy table)
//   - dashboard/src/components/ConfirmDialog.tsx — requireConfirmText precedent
//   - dashboard/src/components/EmergencyConfirmDialog.tsx — composed wrapper precedent

import { useState } from 'react';
import type { TriggerEvent } from '../../types/api';
import { formatAddress, formatTimeAgo } from '../../utils/formatters';

interface CircuitBreakerResetModalProps {
  open: boolean;
  chain: string;
  triggers: TriggerEvent[];
  windowHours: number;
  onConfirmed: () => void;
  onDismiss: () => void;
}

export function CircuitBreakerResetModal({
  open,
  chain,
  triggers,
  windowHours,
  onConfirmed,
  onDismiss,
}: CircuitBreakerResetModalProps) {
  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const allAcknowledged = acknowledged.size === triggers.length && triggers.length > 0;
  // Case-sensitive 'RESET' exact match (no trailing space, no lowercase) per UI-SPEC.
  const textConfirmed = confirmText === 'RESET';
  const confirmDisabled = !allAcknowledged || !textConfirmed || submitting;

  const toggleAcknowledge = (idx: number) => {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const reset = () => {
    setAcknowledged(new Set());
    setConfirmText('');
    setError(null);
    setSubmitting(false);
  };

  const handleDismiss = () => {
    reset();
    onDismiss();
  };

  const handleConfirm = async () => {
    if (confirmDisabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/anti-rug/circuit-breaker/${chain}/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: 'Unknown error' }));
        setError(
          `Reset failed: ${errData.error || 'Unknown error'}. The circuit breaker is still tripped. Check the bot logs.`,
        );
        setSubmitting(false);
        return;
      }
      // Success — the cb_reset WS broadcast hides the banner.
      reset();
      onConfirmed();
    } catch (err) {
      setError(
        `Reset failed: ${err instanceof Error ? err.message : 'Network error'}. The circuit breaker is still tripped. Check the bot logs.`,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — click closes (matches ConfirmDialog.tsx:58 precedent) */}
      <div className="absolute inset-0 bg-surface/70" onClick={handleDismiss} />

      <div className="relative bg-surface-light rounded-lg p-6 w-[640px] max-h-[80vh] overflow-y-auto border border-border shadow-xl">
        <h2 className="text-xl font-bold leading-[1.2]">
          Review and Reset Anti-Rug Circuit Breaker — {chain.toUpperCase()}
        </h2>
        <p className="text-sm mt-3 text-text leading-[1.5]">
          The anti-rug circuit breaker tripped after {triggers.length} triggers within {windowHours} hours. Review every trigger event below. Reset only if you have confirmed each one is a true positive or a known false positive you have decided to ignore.
        </p>

        {/* Per-trigger sections */}
        <div className="mt-4 space-y-3">
          {triggers.map((trig, i) => (
            <div
              key={`${trig.timestamp}-${i}`}
              className="bg-surface rounded p-3 border border-border"
            >
              <h3 className="text-sm font-bold mb-2">
                Trigger {i + 1} of {triggers.length} — fired at {formatTimeAgo(trig.timestamp)}
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-text-muted">Token: </span>
                  <span className="font-mono">{formatAddress(trig.token)}</span>
                </div>
                <div>
                  <span className="text-text-muted">Pair: </span>
                  <span className="font-mono">{formatAddress(trig.pair)}</span>
                </div>
                <div>
                  <span className="text-text-muted">LP removed: </span>
                  <span className="font-mono">{trig.signals.lpRemovedPct}%</span>
                </div>
                <div>
                  <span className="text-text-muted">Destination: </span>
                  <span className="font-mono">{formatAddress(trig.signals.destination)}</span>
                </div>
                <div>
                  <span className="text-text-muted">Allowlist hit: </span>
                  <span>{trig.signals.allowlistHit}</span>
                </div>
                <div>
                  <span className="text-text-muted">Sell-sim slippage: </span>
                  <span className="font-mono">
                    {trig.signals.sellSimSlippagePct ?? trig.signals.v2ReservePctBelow ?? 'n/a'}%
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-text-muted">Outcome: </span>
                  <span>{trig.outcome}</span>
                </div>
              </div>
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged.has(i)}
                  onChange={() => toggleAcknowledge(i)}
                  className="rounded"
                />
                <span className="text-sm">I have reviewed this trigger</span>
              </label>
            </div>
          ))}
        </div>

        {/* RESET-text input — animated reveal after all checkboxes checked */}
        {allAcknowledged && (
          <div className="mt-4">
            <label className="block text-xs text-text-muted mb-1">Type RESET to confirm</label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
                setError(null);
              }}
              className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent font-mono"
              autoFocus
            />
            {confirmText.length > 0 && !textConfirmed && (
              <p className="text-xs text-loss mt-1">You must type RESET exactly to proceed.</p>
            )}
          </div>
        )}

        {/* Inline error rendering per UI-SPEC step 7 */}
        {error && (
          <div className="mt-4 border-l-2 border-loss bg-surface rounded-r px-3 py-2">
            <p className="text-sm text-loss">{error}</p>
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded text-sm bg-surface-lighter text-text-muted hover:text-text transition-colors"
          >
            Close without resetting
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmDisabled}
            title={
              !allAcknowledged ? 'Acknowledge every trigger above before resetting.' : undefined
            }
            className={`px-4 py-2 rounded text-sm text-white transition-colors bg-accent ${
              confirmDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            }`}
          >
            Reset Circuit Breaker
          </button>
        </div>
      </div>
    </div>
  );
}
