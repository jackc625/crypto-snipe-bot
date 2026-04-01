import { useState, useEffect, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
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
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
