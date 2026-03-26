interface TimeRangeSelectorProps {
  value: string;
  onChange: (range: string) => void;
}

const ranges = ['24h', '7d', '30d', 'All'] as const;

export function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-border">
      {ranges.map((range) => {
        const isActive = value === range;
        return (
          <button
            key={range}
            onClick={() => onChange(range)}
            className={`px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? 'bg-accent text-white'
                : 'bg-surface-lighter text-text-muted hover:text-text'
            }`}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
