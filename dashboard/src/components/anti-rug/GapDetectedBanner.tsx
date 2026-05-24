// dashboard/src/components/anti-rug/GapDetectedBanner.tsx
// Phase 19 / Plan 19-06 — Dismissible per-chain backfill-gap warning banner.
//
// Renders when a `antirug_event` with `kind: 'gap-detected'` arrives for the
// chain. Dismissal state persists per (chain, fromBlock) in localStorage so a
// NEW gap event after dismissal re-shows the banner (key collision protection
// per threat T-19-06-07).
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Per-chain WS-health indicator" gap-detected banner copy (verbatim)
//   - dashboard/src/components/ChainStatusCard.tsx:61-80 — dismissible
//     warning-strip precedent

import { useState, useEffect } from 'react';
import type { AntiRugEvent } from '../../types/api';

interface GapDetectedBannerProps {
  chain: string;
  /** The most recent gap-detected event for this chain, or null when none. */
  event: AntiRugEvent | null;
}

export function GapDetectedBanner({ chain, event }: GapDetectedBannerProps) {
  // localStorage key includes both chain AND fromBlock — a fresh gap event
  // with a new fromBlock re-shows the banner even after dismissal of an older
  // one (auto-resolve UX per threat T-19-06-07 mitigation).
  const fromBlock = event?.fromBlock ?? 0;
  const storageKey = `antirug-gap-dismissed-${chain}-${fromBlock}`;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  // Reset dismissed flag when fromBlock changes (new gap event arrived).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDismissed(window.localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  if (!event || event.kind !== 'gap-detected' || dismissed) return null;

  const handleDismiss = () => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, '1');
      }
    } catch {
      // localStorage unavailable -- best-effort
    }
    setDismissed(true);
  };

  const upper = chain.toUpperCase();
  const blocks = event.gapBlocks ?? 0;
  const from = event.fromBlock ?? '?';
  const to = event.toBlock ?? '?';

  return (
    <div className="border-l-2 border-warning bg-surface-light rounded-r-lg px-4 py-3 mb-4 relative">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-text-muted hover:text-text transition-colors"
        aria-label="Dismiss gap-detected banner"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <p className="text-sm text-warning pr-8">
        [GAP DETECTED] {upper} missed {blocks} blocks ({from}—{to}). Backfill skipped. Review anti-rug events manually before resuming live mode.
      </p>
    </div>
  );
}
