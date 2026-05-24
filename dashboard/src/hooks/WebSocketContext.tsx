import { createContext, useContext, type ReactNode } from 'react';
import { useWebSocket } from './useWebSocket';
import type {
  Position,
  NotificationEvent,
  ChainStatus,
  WsEvent,
  AntiRugEvent,
  ChainWsHealthChange,
  CbTrippedPayload,
} from '../types/api';

interface WebSocketContextValue {
  connected: boolean;
  lastMessage: WsEvent<unknown> | null;
  positions: Position[];
  notifications: NotificationEvent[];
  chainStatuses: ChainStatus[];
  // Phase 19 / Plan 19-06 — anti-rug push state
  antiRugEvents: Record<string, AntiRugEvent[]>;
  chainWsHealth: Record<string, ChainWsHealthChange>;
  circuitBreakerTrips: Record<string, CbTrippedPayload>;
}

const WebSocketCtx = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();
  return <WebSocketCtx.Provider value={ws}>{children}</WebSocketCtx.Provider>;
}

export function useWs(): WebSocketContextValue {
  const ctx = useContext(WebSocketCtx);
  if (!ctx) {
    throw new Error('useWs must be used within a WebSocketProvider');
  }
  return ctx;
}
