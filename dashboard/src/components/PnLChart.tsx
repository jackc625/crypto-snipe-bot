import { useEffect, useRef } from 'react';
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, type AreaSeriesPartialOptions } from 'lightweight-charts';
import { TimeRangeSelector } from './TimeRangeSelector';

interface PnLChartProps {
  dataPoints: { time: number; value: number }[];
  range: string;
  onRangeChange: (range: string) => void;
  loading?: boolean;
}

export function PnLChart({ dataPoints, range, onRangeChange, loading }: PnLChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const posSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const negSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      timeScale: {
        timeVisible: true,
        borderColor: '#1e293b',
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      },
      width: containerRef.current.clientWidth,
      height: 300,
    });

    chartRef.current = chart;

    const posOptions: AreaSeriesPartialOptions = {
      lineColor: '#22c55e',
      topColor: 'rgba(34, 197, 94, 0.4)',
      bottomColor: 'rgba(34, 197, 94, 0.0)',
      lineWidth: 2,
    };

    const negOptions: AreaSeriesPartialOptions = {
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0.0)',
      bottomColor: 'rgba(239, 68, 68, 0.4)',
      lineWidth: 2,
    };

    posSeriesRef.current = chart.addSeries(AreaSeries, posOptions);
    negSeriesRef.current = chart.addSeries(AreaSeries, negOptions);

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update data when dataPoints change
  useEffect(() => {
    if (!posSeriesRef.current || !negSeriesRef.current) return;

    const sorted = [...dataPoints].sort((a, b) => a.time - b.time);

    // Positive series: values above zero, zero otherwise
    const posData = sorted.map((p) => ({
      time: p.time as import('lightweight-charts').UTCTimestamp,
      value: p.value >= 0 ? p.value : 0,
    }));

    // Negative series: values below zero, zero otherwise
    const negData = sorted.map((p) => ({
      time: p.time as import('lightweight-charts').UTCTimestamp,
      value: p.value < 0 ? p.value : 0,
    }));

    posSeriesRef.current.setData(posData);
    negSeriesRef.current.setData(negData);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [dataPoints]);

  return (
    <div className="bg-surface-light rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold leading-[1.2]">Cumulative P&L</h3>
        <TimeRangeSelector value={range} onChange={onRangeChange} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <div className="text-accent animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
        </div>
      ) : (
        <div ref={containerRef} />
      )}
    </div>
  );
}
