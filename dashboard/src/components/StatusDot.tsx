interface StatusDotProps {
  status: 'running' | 'stopped' | 'disconnected' | 'connected' | 'reconnecting';
}

const statusStyles: Record<StatusDotProps['status'], string> = {
  running: 'bg-profit animate-pulse',
  connected: 'bg-profit animate-pulse',
  stopped: 'bg-warning',
  disconnected: 'bg-loss',
  reconnecting: 'bg-loss',
};

export function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${statusStyles[status]}`}
      role="status"
      aria-label={status}
    />
  );
}
