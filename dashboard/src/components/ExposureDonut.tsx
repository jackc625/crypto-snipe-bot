import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type Plugin,
} from 'chart.js';
import { formatEth } from '../utils/formatters';

ChartJS.register(ArcElement, Tooltip, Legend);

interface ExposureDonutProps {
  exposure: { total: number; byChain: Record<string, number> };
}

const chainColors: Record<string, string> = {
  eth: '#627eea',
  bsc: '#f0b90b',
  base: '#0052ff',
  arb: '#28a0f0',
};

const chainLabels: Record<string, string> = {
  eth: 'Ethereum',
  bsc: 'BSC',
  base: 'Base',
  arb: 'Arbitrum',
};

// Plugin to render center text
const centerTextPlugin: Plugin<'doughnut'> = {
  id: 'centerText',
  afterDraw(chart) {
    const { ctx, width, height } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data.length) return;

    ctx.save();

    // Label
    ctx.font = '400 12px Inter, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Total Exposure', width / 2, height / 2 - 10);

    // Value
    const totalExposure = (chart.config.data as { datasets: { data: number[] }[] }).datasets[0].data
      .reduce((sum: number, v: number) => sum + v, 0);
    ctx.font = '700 20px Inter, sans-serif';
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(formatEth(totalExposure), width / 2, height / 2 + 12);

    ctx.restore();
  },
};

export function ExposureDonut({ exposure }: ExposureDonutProps) {
  const chains = Object.keys(exposure.byChain);
  const values = chains.map((c) => exposure.byChain[c]);
  const colors = chains.map((c) => chainColors[c.toLowerCase()] || '#64748b');
  const labels = chains.map((c) => chainLabels[c.toLowerCase()] || c.toUpperCase());

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#94a3b8',
          font: { family: 'Inter, sans-serif', size: 12 },
          padding: 16,
        },
      },
      tooltip: {
        callbacks: {
          label: (context: { label: string; parsed: number }) => {
            return `${context.label}: ${formatEth(context.parsed)}`;
          },
        },
      },
    },
  };

  return (
    <div className="bg-surface-light rounded-lg border border-border p-4">
      <h3 className="text-xl font-bold leading-[1.2] mb-4">Exposure by Chain</h3>
      <div className="h-[250px]">
        {chains.length > 0 ? (
          <Doughnut data={data} options={options} plugins={[centerTextPlugin]} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted text-sm">No exposure data available</p>
          </div>
        )}
      </div>
    </div>
  );
}
