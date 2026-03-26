interface RiskGaugeProps {
  label: string;
  used: number;
  max: number;
  format?: (used: number, max: number) => string;
}

export function RiskGauge({ label, used, max, format }: RiskGaugeProps) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;

  // Color transitions: accent (0-70%), warning (70-90%), loss (90-100%)
  let barColor: string;
  if (pct >= 90) {
    barColor = 'bg-loss';
  } else if (pct >= 70) {
    barColor = 'bg-warning';
  } else {
    barColor = 'bg-accent';
  }

  const displayValue = format
    ? format(used, max)
    : `${used} / ${max}`;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-muted">{label}</span>
        <span className="text-xs font-mono text-text">{displayValue}</span>
      </div>
      <div className="w-full h-2 bg-surface-lighter rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
