/**
 * Format a P&L value with +/- prefix and 4 decimal places.
 * Returns "-.---" for null values.
 */
export function formatPnL(value: number | null): string {
  if (value === null || value === undefined) return '-.---';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(4)}`;
}

/**
 * Format an ETH/BNB value to 4 decimal places.
 */
export function formatEth(value: number | string | null): string {
  if (value === null || value === undefined) return '-.----';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '-.----';
  return num.toFixed(4);
}

/**
 * Format a duration in seconds to a human-readable string.
 * Returns "2h 15m" or "3d 4h" or "--" for null.
 */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '--';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

/**
 * Format a timestamp to a relative time string like "2m ago", "1h ago", "3d ago".
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Format a hex address to a shortened form: "0x1234...5678".
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address || '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Return a Tailwind text color class based on P&L value.
 */
export function pnlColor(value: number | null): string {
  if (value === null || value === 0) return 'text-text';
  return value > 0 ? 'text-profit' : 'text-loss';
}

/**
 * Map severity to a Tailwind border color class per D-38.
 */
export function severityColor(severity: string): string {
  switch (severity) {
    case 'success': return 'border-profit';
    case 'warning': return 'border-warning';
    case 'error': return 'border-loss';
    case 'info': return 'border-info';
    default: return 'border-border';
  }
}
