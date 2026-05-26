// dashboard/src/components/PauseBanner.tsx
// Phase 20 / Plan 20-06 / OPS-LIVE-09 D-PAUSE-UI — Card-idiom red pause banner.
//
// Renders only when useWs().pauseState.paused === true. As of Phase 20 plan 20-10
// (live-UAT test-2 cosmetic gap) the banner uses the dashboard card idiom — a
// contained dark card (bg-surface-light + border + rounded-lg + p-4) with a red
// left-border accent (border-loss border-l-4) and text-loss icon + heading —
// rather than the original full-bleed bg-loss slab, which "didn't appear at all
// like the rest of the dashboard." It remains an UNMISTAKABLE red alert so the
// operator instantly recognises that "something blocking new trades is happening"
// regardless of which subsystem flipped the global stop flag. Visual parity with
// CircuitBreakerBanner.tsx is maintained — both banners moved to the card idiom
// together in 20-10.
//
// Banner copy per D-PAUSE-UI:
//   "BOT PAUSED — since {paused_at_formatted} by {pausedBy}. {reason}"  + Resume button
//
// Resume button POSTs /api/controls/resume (Plan 20-05). On success, the server
// broadcasts the `pause_state_change paused:false` WS event which drives the
// component to unmount via the useWebSocket dispatch — the component itself does
// NOT touch pauseState locally. This avoids the failure mode where the UI shows
// "resumed" while the server still believes it is paused (per T-20-W6-02
// reconciliation invariant).
//
// References:
//   - .planning/phases/20-going-live-ops-hardening/20-CONTEXT.md — D-PAUSE-UI
//   - .planning/phases/20-going-live-ops-hardening/20-RESEARCH.md §10 + Open Question 10
//   - dashboard/src/components/anti-rug/CircuitBreakerBanner.tsx — visual analog
//   - dashboard/src/hooks/WebSocketContext.tsx — useWs().pauseState source

import { useState } from 'react';
import { PauseCircle } from 'lucide-react';
import { useWs } from '../hooks/WebSocketContext';

export function PauseBanner() {
  const { pauseState } = useWs();
  // WR-04 fix: track in-flight resume so a double-click cannot fire a second
  // POST /api/controls/resume. The previous version allowed two POSTs to race
  // → two clearPauseState writes → two broadcast events → audit-log noise.
  // On network failure we re-enable the button so the operator can retry; on
  // success, the WS pause_state_change event drives the component to unmount
  // (no need to reset resuming).
  const [resuming, setResuming] = useState(false);
  if (!pauseState || !pauseState.paused) return null;

  // Format unix seconds → operator-localised string. Null falls back to a
  // sentinel rather than rendering "Invalid Date" — the GET /api/controls/pause
  // hydration path returns pausedAt: null for not-yet-seeded rows.
  const formatTs = (ts: number | null) =>
    ts ? new Date(ts * 1000).toLocaleString() : 'unknown';

  async function handleResume() {
    if (resuming) return;
    setResuming(true);
    try {
      // credentials: 'include' is required by the dashboard session-cookie auth
      // middleware (matches the same pattern as useApi.ts and the CB-reset POST).
      const res = await fetch('/api/controls/resume', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`Resume failed: ${res.status}`);
      // Deliberately do NOT setPauseState locally — the WS pause_state_change
      // event (broadcast by controls.ts POST /resume handler) drives the
      // component unmount. This keeps the server as the single source of truth
      // for pause state.
    } catch (e) {
      // Network failure → leave the banner visible and re-enable the button so
      // the operator can retry by clicking Resume again, or fall back to
      // `npm run resume` on the host.
      console.error('Resume request failed', e);
      setResuming(false);
    }
  }

  return (
    <div className="bg-surface-light border border-loss border-l-4 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <PauseCircle className="w-5 h-5 shrink-0 mt-0.5 text-loss" />
        <div className="flex-1">
          <h2 className="text-xl font-bold leading-[1.2] text-loss">
            BOT PAUSED — since {formatTs(pauseState.pausedAt)} by {pauseState.pausedBy ?? 'unknown'}
          </h2>
          <p className="text-sm mt-1 text-text-muted">{pauseState.reason ?? 'No reason provided.'}</p>
          <button
            type="button"
            onClick={handleResume}
            disabled={resuming}
            className={`inline-flex items-center gap-2 mt-3 bg-accent text-white rounded px-4 py-2 text-sm hover:opacity-90 transition-colors ${
              resuming ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {resuming ? 'Resuming...' : 'Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}
