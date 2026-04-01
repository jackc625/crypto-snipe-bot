import { NavLink } from 'react-router-dom';
import { LayoutDashboard, History, ShieldAlert, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusDot } from './StatusDot';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  wsConnected: boolean;
  telegramStatus: 'connected' | 'disconnected' | 'not-configured';
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/trades', icon: History, label: 'Trade History' },
  { to: '/risk', icon: ShieldAlert, label: 'Risk & Exposure' },
  { to: '/chains', icon: Settings, label: 'Chain Controls' },
];

export function Sidebar({ collapsed, onToggle, wsConnected, telegramStatus }: SidebarProps) {
  return (
    <nav
      className={`flex flex-col bg-surface-light border-r border-border h-screen shrink-0 transition-all duration-200 ${
        collapsed ? 'w-[56px]' : 'w-[240px]'
      }`}
    >
      {/* Navigation items */}
      <div className="flex-1 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            aria-label={item.label}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 text-sm transition-colors min-h-[44px] ${
                isActive
                  ? 'border-l-[3px] border-accent bg-surface-lighter text-text pl-[13px]'
                  : 'border-l-[3px] border-transparent text-text-muted hover:text-text hover:bg-surface-lighter pl-[13px]'
              }`
            }
          >
            <item.icon size={20} className="shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </div>

      {/* Footer: WebSocket status + toggle */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 mb-1">
          <StatusDot status={wsConnected ? 'connected' : 'reconnecting'} />
          {!collapsed && (
            <span className="text-xs text-text-muted">
              {wsConnected ? 'Connected' : 'Reconnecting...'}
            </span>
          )}
        </div>
        {/* Telegram status */}
        <div className="flex items-center gap-2 mt-1 mb-3">
          <StatusDot
            status={
              telegramStatus === 'connected'
                ? 'connected'
                : 'disconnected'
            }
          />
          {!collapsed && (
            <span className="text-xs text-text-muted">
              {telegramStatus === 'connected'
                ? 'Telegram: Connected'
                : telegramStatus === 'not-configured'
                ? 'Telegram: Not configured'
                : 'Telegram: Disconnected'}
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="flex items-center justify-center w-full py-1 text-text-muted hover:text-text transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </nav>
  );
}
