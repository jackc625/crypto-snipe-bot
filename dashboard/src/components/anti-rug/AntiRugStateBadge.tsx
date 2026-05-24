// dashboard/src/components/anti-rug/AntiRugStateBadge.tsx
// Phase 19 / Plan 19-06 — Per-position 6-state anti-rug badge.
//
// Renders one of 6 semantic badges with the colours + labels declared in
// UI-SPEC §"Anti-Rug column header and badges". Click opens the
// AntiRugExitDetailModal (parent component owns the modal-open state);
// e.stopPropagation() prevents the parent row's expand/collapse toggle.
//
// References:
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-UI-SPEC.md
//       §"Anti-Rug column header and badges" (color + label + tooltip table)
//   - .planning/phases/19-anti-rug-runtime-monitoring/19-PATTERNS.md
//       §"Dashboard: AntiRugStateBadge.tsx" (lines 916-955)
//   - dashboard/src/components/ChainBadge.tsx — badge primitive precedent
//   - dashboard/src/components/PositionTable.tsx:194 — e.stopPropagation precedent

import type { AntiRugMonitorState } from '../../types/api';

interface AntiRugStateBadgeProps {
  state: AntiRugMonitorState;
  chain: string;
  onClick?: () => void;
  /** Tooltip text per UI-SPEC §"Anti-Rug column header and badges" tooltip table. */
  title?: string;
}

const stateStyles: Record<AntiRugMonitorState, { bg: string; label: string }> = {
  'live': { bg: 'bg-profit text-white', label: 'Live' },
  'dry-run': { bg: 'bg-warning text-white', label: 'Dry-run' },
  'would-have-sold': { bg: 'bg-warning text-text', label: 'Would-have-sold' },
  'exit-fired': { bg: 'bg-loss text-white', label: 'Exit fired' },
  'halted': { bg: 'bg-[#1f2937] text-white border-l-2 border-loss', label: 'Halted (CB)' },
  'unmonitored': { bg: 'bg-surface-lighter text-text-disabled', label: 'Unmonitored' },
};

export function AntiRugStateBadge({ state, onClick, title }: AntiRugStateBadgeProps) {
  const style = stateStyles[state] ?? stateStyles['unmonitored'];
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
      {style.label}
    </button>
  );
}
