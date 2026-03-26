import { useState, useEffect, useRef } from 'react';
import type { NotificationEvent } from '../types/api';
import { ChainBadge } from './ChainBadge';
import { FilterChips } from './FilterChips';
import { formatTimeAgo, severityColor } from '../utils/formatters';

interface EventFeedProps {
  events: NotificationEvent[];
  maxEvents?: number;
}

const categoryOptions = [
  { id: 'trade', label: 'Trade' },
  { id: 'risk', label: 'Risk' },
  { id: 'system', label: 'System' },
  { id: 'error', label: 'Error' },
];

const chainOptions = [
  { id: 'eth', label: 'ETH' },
  { id: 'bsc', label: 'BSC' },
  { id: 'base', label: 'BASE' },
  { id: 'arb', label: 'ARB' },
];

export function EventFeed({ events, maxEvents = 100 }: EventFeedProps) {
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedChains, setSelectedChains] = useState<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest (top of list since events are prepended)
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events.length]);

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleChain = (id: string) => {
    setSelectedChains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filter events
  const filtered = events.filter((evt) => {
    if (selectedCategories.size > 0 && !selectedCategories.has(evt.category.toLowerCase())) {
      return false;
    }
    if (selectedChains.size > 0 && evt.chain && !selectedChains.has(evt.chain.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="bg-surface-light border border-border rounded-lg p-4">
      <h3 className="text-xl font-bold mb-3">Live Events</h3>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-4 mb-3">
        <FilterChips options={categoryOptions} selected={selectedCategories} onToggle={toggleCategory} />
        <FilterChips options={chainOptions} selected={selectedChains} onToggle={toggleChain} />
      </div>

      {/* Overflow indicator */}
      {events.length >= maxEvents && (
        <p className="text-xs text-text-muted mb-2">Showing latest 100 events</p>
      )}

      {/* Event list */}
      <div ref={feedRef} className="max-h-[400px] overflow-y-auto space-y-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            {events.length === 0
              ? 'No events yet. Events will appear as the bot operates.'
              : 'No events match the selected filters.'}
          </p>
        ) : (
          filtered.map((evt, i) => (
            <div
              key={`${evt.timestamp}-${i}`}
              className={`flex items-start gap-3 px-3 py-2 rounded border-l-2 ${severityColor(evt.severity)} bg-surface/50`}
            >
              <span className="text-xs text-text-muted whitespace-nowrap shrink-0">
                {formatTimeAgo(evt.timestamp)}
              </span>
              {evt.chain && <ChainBadge chain={evt.chain} />}
              <span className="text-sm text-text flex-1">{evt.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
