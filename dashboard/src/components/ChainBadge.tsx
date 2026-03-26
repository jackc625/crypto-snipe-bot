interface ChainBadgeProps {
  chain: string;
}

const chainColors: Record<string, string> = {
  eth: 'bg-chain-eth',
  bsc: 'bg-chain-bsc',
  base: 'bg-chain-base',
  arb: 'bg-chain-arb',
};

const chainLabels: Record<string, string> = {
  eth: 'ETH',
  bsc: 'BSC',
  base: 'BASE',
  arb: 'ARB',
};

export function ChainBadge({ chain }: ChainBadgeProps) {
  const key = chain.toLowerCase();
  const bg = chainColors[key] || 'bg-surface-lighter';
  const label = chainLabels[key] || chain.toUpperCase();

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-sans text-white ${bg}`}
    >
      {label}
    </span>
  );
}
