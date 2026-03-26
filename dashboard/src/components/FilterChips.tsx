interface FilterChipsProps {
  options: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export function FilterChips({ options, selected, onToggle }: FilterChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isActive = selected.has(opt.id);
        return (
          <button
            key={opt.id}
            onClick={() => onToggle(opt.id)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              isActive
                ? 'bg-accent text-white'
                : 'bg-surface-lighter text-text-muted hover:text-text'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
