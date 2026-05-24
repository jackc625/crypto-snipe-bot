// dashboard/src/components/PauseBanner.tsx
// Phase 20 / Plan 20-06 / OPS-LIVE-09 D-PAUSE-UI — Full-bleed red pause banner.
//
// Renders only when useWs().pauseState.paused === true. Visual parity with the
// Phase 19 CircuitBreakerBanner.tsx is intentional (per RESEARCH §Open Question 10
// "banner color recommendation — same bg-loss text-white as CB banner") so the
// operator instantly recognises that "something blocking new trades is happening"
// regardless of which subsystem flipped the global stop flag.
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

import { PauseCircle } from 'lucide-react';
import { useWs } from '../hooks/WebSocketContext';

export function PauseBanner() {
  const { pauseState } = useWs();
  if (!pauseState || !pauseState.paused) return null;

  // Format unix seconds → operator-localised string. Null falls back to a
  // sentinel rather than rendering "Invalid Date" — the GET /api/controls/pause
  // hydration path returns pausedAt: null for not-yet-seeded rows.
  const formatTs = (ts: number | null) =>
    ts ? new Date(ts * 1000).toLocaleString() : 'unknown';

  async function handleResume() {
    try {
      // credentials: 'include' is required by the dashboard session-cookie auth
      // middleware (matches the same pattern as useApi.ts and the CB-reset POST).
      await fetch('/api/controls/resume', { method: 'POST', credentials: 'include' });
      // Deliberately do NOT setPauseState locally — the WS pause_state_change
      // event (broadcast by controls.ts POST /resume handler) drives the
      // component unmount. This keeps the server as the single source of truth
      // for pause state.
    } catch (e) {
      // Network failure → leave the banner visible. The operator can retry by
      // clicking Resume again, or fall back to `npm run resume` on the host.
      console.error('Resume request failed', e);
    }
  }

  return (
    <div className="bg-loss text-white py-3 px-4 mb-4 -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="flex items-start gap-3">
        <PauseCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="text-xl font-bold leading-[1.2]">
            BOT PAUSED — since {formatTs(pauseState.pausedAt)} by {pauseState.pausedBy ?? 'unknown'}
          </h2>
          <p className="text-sm mt-1">{pauseState.reason ?? 'No reason provided.'}</p>
          <button
            type="button"
            onClick={handleResume}
            className="inline-flex items-center gap-2 mt-3 bg-surface-light rounded px-3 py-1 hover:opacity-80 transition-opacity text-accent underline"
          >
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
