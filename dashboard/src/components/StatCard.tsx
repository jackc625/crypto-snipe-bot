interface StatCardProps {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function StatCard({ label, value }: StatCardProps) {
  let valueColor = 'text-text';
  if (value.startsWith('+')) valueColor = 'text-profit';
  else if (value.startsWith('-') && value !== '-.---' && value !== '-.----') valueColor = 'text-loss';

  return (
    <div className="bg-surface-light border border-border rounded-lg p-4 min-w-[200px]">
      <p className="text-xs text-text-muted leading-[1.4]">{label}</p>
      <p className={`text-[28px] font-bold leading-[1.1] mt-1 ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}
