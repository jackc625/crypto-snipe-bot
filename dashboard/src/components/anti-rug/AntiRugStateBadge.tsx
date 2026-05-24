// dashboard/src/components/anti-rug/AntiRugStateBadge.tsx
// Phase 19 / Plan 19-06 — Per-position 6-state anti-rug badge.
//
// Renders one of 6 semantic badges with the colours + labels declared in
// UI-SPEC §"Anti-Rug column header and badges". Click opens the
// AntiRugExitDetailModal (parent component owns the modal-open state);
// e.stopPropagation() prevents the parent row's expand/collapse toggle.
//
// CR-06-FOLLOWUP (iter-2): when `state === 'exit-fired'`, the optional
// `success` prop differentiates a confirmed live exit from a failed one:
//   - `success === true`  → append a green check (✓) to the 'Exit fired'
//                            label so the operator can see at a glance
//                            that executeFullSell returned true.
//   - `success === false` → append a white X (✗) and keep the red bg —
//                            indicates a failed live exit; the position
//                            is still open and a trigger slot was
//                            consumed (CB one step closer to tripping).
//   - `success === undefined` → original 'Exit fired' label unchanged
//                                (covers the would-have-sold dry-run
//                                path where success isn't applicable;
//                                also covers older positions in flight
//                                before the iter-2 wire change landed).
// For every state OTHER than 'exit-fired', the `success` prop is ignored
// — the 6-state visual contract from UI-SPEC §"Anti-Rug column header
// and badges" is preserved unchanged.
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Anti-Rug column header and badges" (color + label + tooltip table)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"Dashboard: AntiRugStateBadge.tsx" (lines 916-955)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-REVIEW.md
//       §"CR-06-FOLLOWUP" (iter-2)
//   - dashboard/src/components/ChainBadge.tsx — badge primitive precedent
//   - dashboard/src/components/PositionTable.tsx:194 — e.stopPropagation precedent

import type { AntiRugMonitorState } from '../../types/api';

interface AntiRugStateBadgeProps {
  state: AntiRugMonitorState;
  chain: string;
  onClick?: () => void;
  /** Tooltip text per UI-SPEC §"Anti-Rug column header and badges" tooltip table. */
  title?: string;
  /**
   * CR-06-FOLLOWUP (iter-2): live-exit success/failure indicator. Only
   * affects rendering when `state === 'exit-fired'` — for every other
   * state the 6-badge visual contract is preserved unchanged.
   */
  success?: boolean;
}

const stateStyles: Record<AntiRugMonitorState, { bg: string; label: string }> = {
  'live': { bg: 'bg-profit text-white', label: 'Live' },
  'dry-run': { bg: 'bg-warning text-white', label: 'Dry-run' },
  'would-have-sold': { bg: 'bg-warning text-text', label: 'Would-have-sold' },
  'exit-fired': { bg: 'bg-loss text-white', label: 'Exit fired' },
  'halted': { bg: 'bg-[#1f2937] text-white border-l-2 border-loss', label: 'Halted (CB)' },
  'unmonitored': { bg: 'bg-surface-lighter text-text-disabled', label: 'Unmonitored' },
};

export function AntiRugStateBadge({ state, onClick, title, success }: AntiRugStateBadgeProps) {
  const style = stateStyles[state] ?? stateStyles['unmonitored'];
  // CR-06-FOLLOWUP: success/failure suffix on exit-fired only. We append a
  // glyph rather than swapping the badge color away from `bg-loss` so the
  // existing UI-SPEC color contract (bg-loss on exit-fired) is preserved
  // and tests asserting `bg-loss` on this state continue to pass.
  let successSuffix = '';
  if (state === 'exit-fired') {
    if (success === true) successSuffix = ' ✓';      // ✓
    else if (success === false) successSuffix = ' ✗'; // ✗
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        // Prevent the parent row toggle (PositionTable.tsx:194 precedent).
        e.stopPropagation();
        onClick?.();
      }}
      title={title}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${style.bg}`}
    >
      {style.label}{successSuffix}
    </button>
  );
}
