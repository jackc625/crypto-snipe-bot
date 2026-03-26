import { useState, useCallback } from 'react';
import type { Trade, Pagination } from '../types/api';
import { TradeTable } from '../components/TradeTable';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { useApi } from '../hooks/useApi';

interface TradesResponse {
  trades: Trade[];
  pagination: Pagination;
}

export function TradeHistory() {
  const [range, setRange] = useState('7d');
  const [chain, setChain] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [page, setPage] = useState(1);

  // Pending filter state (applied on button click)
  const [pendingRange, setPendingRange] = useState('7d');
  const [pendingChain, setPendingChain] = useState('all');
  const [pendingOutcome, setPendingOutcome] = useState('all');

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (range !== 'All') {
      const now = Date.now();
      const rangeMs: Record<string, number> = {
        '24h': 86400000,
        '7d': 604800000,
        '30d': 2592000000,
      };
      const from = new Date(now - (rangeMs[range] || 0)).toISOString().split('T')[0];
      params.set('from', from);
    }
    if (chain !== 'all') params.set('chain', chain);
    if (outcome !== 'all') params.set('outcome', outcome);
    return `/api/trades?${params.toString()}`;
  }, [page, range, chain, outcome]);

  const { data, loading, error } = useApi<TradesResponse>(buildUrl());

  const handleApplyFilters = () => {
    setRange(pendingRange);
    setChain(pendingChain);
    setOutcome(pendingOutcome);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleExportCsv = async () => {
    const params = new URLSearchParams();
    if (range !== 'All') {
      const now = Date.now();
      const rangeMs: Record<string, number> = {
        '24h': 86400000,
        '7d': 604800000,
        '30d': 2592000000,
      };
      const from = new Date(now - (rangeMs[range] || 0)).toISOString().split('T')[0];
      params.set('from', from);
    }
    if (chain !== 'all') params.set('chain', chain);
    if (outcome !== 'all') params.set('outcome', outcome);

    try {
      const response = await fetch(`/api/trades/export?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trades-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Export error handled silently -- user sees no download
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold leading-[1.2]">Trade History</h1>
        <button
          onClick={handleExportCsv}
          className="px-4 py-2 rounded text-sm bg-accent text-white hover:opacity-90 transition-colors"
        >
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-surface-light rounded-lg border border-border">
        <div>
          <label className="block text-xs text-text-muted mb-1">Time Range</label>
          <TimeRangeSelector value={pendingRange} onChange={setPendingRange} />
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Chain</label>
          <select
            value={pendingChain}
            onChange={(e) => setPendingChain(e.target.value)}
            className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="eth">ETH</option>
            <option value="bsc">BSC</option>
            <option value="base">BASE</option>
            <option value="arb">ARB</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">Outcome</label>
          <select
            value={pendingOutcome}
            onChange={(e) => setPendingOutcome(e.target.value)}
            className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="profit">Profit</option>
            <option value="loss">Loss</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={handleApplyFilters}
            className="px-4 py-1.5 rounded text-sm bg-accent text-white hover:opacity-90 transition-colors"
          >
            Apply Filters
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 mb-4 border-l-4 border-loss bg-surface-light rounded">
          <p className="text-sm text-text">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-[44px] bg-surface-lighter rounded animate-pulse" />
          ))}
        </div>
      )}

      {/* Data state */}
      {!loading && !error && data && data.trades.length > 0 && (
        <TradeTable
          trades={data.trades}
          pagination={data.pagination}
          onPageChange={handlePageChange}
        />
      )}

      {/* Empty state */}
      {!loading && !error && data && data.trades.length === 0 && (
        <div className="text-center py-16">
          <p className="text-text-muted">
            No trades match the current filters. Try adjusting the time range or chain selection.
          </p>
        </div>
      )}
    </div>
  );
}
