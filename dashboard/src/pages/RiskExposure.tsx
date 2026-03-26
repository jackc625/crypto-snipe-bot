import { useState } from 'react';
import { PnLChart } from '../components/PnLChart';
import { ExposureDonut } from '../components/ExposureDonut';
import { RiskGauge } from '../components/RiskGauge';
import { useApi } from '../hooks/useApi';
import type { RiskExposure as RiskExposureType, RiskLimits, PnLDataPoint } from '../types/api';

interface PnLResponse {
  dataPoints: PnLDataPoint[];
  range: string;
}

export function RiskExposure() {
  const [pnlRange, setPnlRange] = useState('7d');

  const { data: pnlData, loading: pnlLoading } = useApi<PnLResponse>(
    `/api/risk/pnl?range=${pnlRange}`
  );
  const { data: exposureData } = useApi<RiskExposureType>('/api/risk/exposure');
  const { data: limitsData } = useApi<RiskLimits>('/api/risk/limits');

  return (
    <div>
      <h1 className="text-xl font-bold leading-[1.2] mb-6">Risk & Exposure</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* P&L Chart - spans 2 columns on large screens */}
        <div className="lg:col-span-2">
          <PnLChart
            dataPoints={pnlData?.dataPoints || []}
            range={pnlRange}
            onRangeChange={setPnlRange}
            loading={pnlLoading}
          />
        </div>

        {/* Right column: donut + gauges */}
        <div className="space-y-6">
          {/* Exposure Donut */}
          {exposureData && (
            <ExposureDonut exposure={exposureData} />
          )}

          {/* Risk Gauges */}
          {limitsData && (
            <div className="bg-surface-light rounded-lg border border-border p-4">
              <h3 className="text-xl font-bold leading-[1.2] mb-4">Risk Limits</h3>
              <RiskGauge
                label="Position Limit"
                used={limitsData.positionLimit.used}
                max={limitsData.positionLimit.max}
              />
              <RiskGauge
                label="Daily Loss Limit"
                used={limitsData.dailyLoss.used}
                max={limitsData.dailyLoss.limitPct}
                format={(used, max) => `${used.toFixed(2)} / ${max}%`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
