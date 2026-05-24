// dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx
// Phase 19 / Plan 19-06 — Full-bleed CB-tripped alert banner.
//
// Renders only when at least one chain is in `circuitBreakerTrips`. For
// multi-chain trips, renders one ChainBadge chip per tripped chain inside the
// single banner; clicking a chip opens the reset modal targeted at that
// specific chain. Banner has NO dismiss — only a successful reset hides the
// associated chain chip (per UI-SPEC §"CB-banner interaction").
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Circuit Breaker banner" + §"CB-banner interaction"
//   - dashboard/src/pages/Overview.tsx:166-170 — loss-border banner precedent
//     (Phase 19 promotes this to full-bleed)

import { AlertOctagon } from 'lucide-react';
import type { CbTrippedPayload } from '../../types/api';
import { ChainBadge } from '../ChainBadge';

interface CircuitBreakerBannerProps {
  /** Per-chain map of currently-tripped circuit breakers. */
  trips: Record<string, CbTrippedPayload>;
  /** Click handler when operator clicks a chain chip / CTA — opens reset modal targeted at this chain. */
  onResetClick: (chain: string) => void;
}

export function CircuitBreakerBanner({ trips, onResetClick }: CircuitBreakerBannerProps) {
  const trippedChains = Object.keys(trips);
  if (trippedChains.length === 0) return null;

  // For single-chain trip, headline includes chain + count; for multi, aggregate.
  const isSingle = trippedChains.length === 1;
  const single = isSingle ? trips[trippedChains[0]] : null;

  return (
    <div className="bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="flex items-start gap-3">
        <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-xl font-bold leading-[1.2]">
            {isSingle && single
              ? `ANTI-RUG HALTED ON ${trippedChains[0].toUpperCase()} — ${single.triggerCount} triggers in last hour`
              : `ANTI-RUG HALTED ON ${trippedChains.length} CHAINS`}
          </h2>
          <p className="text-sm mt-1">
            Anti-rug monitoring is paused on this chain. New positions will open without anti-rug coverage until you review the triggers and reset the breaker.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {trippedChains.map((chain) => (
              <button
                key={chain}
                type="button"
                onClick={() => onResetClick(chain)}
                className="inline-flex items-center gap-2 bg-surface-light rounded px-2 py-1 hover:opacity-80 transition-opacity"
              >
                <ChainBadge chain={chain} />
                <span className="text-xs text-accent underline">Click to review and reset</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
