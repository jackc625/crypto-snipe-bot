import { useState, useEffect, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { PauseBanner } from './PauseBanner';
import { useWs } from '../hooks/WebSocketContext';
import { useApi } from '../hooks/useApi';
import type { HealthResponse } from '../types/api';

const SIDEBAR_KEY = 'sidebar-collapsed';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  });
  const { connected } = useWs();
  const { data: healthData } = useApi<HealthResponse>('/health');

  const telegramStatus: 'connected' | 'disconnected' | 'not-configured' = healthData?.telegramConnected
    ? 'connected'
    : healthData?.telegramError === 'Not configured' || !healthData
    ? 'not-configured'
    : 'disconnected';

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        wsConnected={connected}
        telegramStatus={telegramStatus}
      />
      {/* Phase 20 / Plan 20-06 — PauseBanner sits inside the scroll area so it
          is the first thing the operator sees on every dashboard page when the
          bot is globally paused, per D-PAUSE-UI "header banner visible on
          every dashboard page". As of plan 20-10 the banner is a contained card
          (matching the sibling dashboard cards) that lives inside this p-8
          scroll container, so it no longer needs the full-bleed negative
          margins it previously used to span the <main> padding. */}
      <div className="flex-1 overflow-y-auto p-8">
        <PauseBanner />
        <main>{children}</main>
      </div>
    </div>
  );
}
