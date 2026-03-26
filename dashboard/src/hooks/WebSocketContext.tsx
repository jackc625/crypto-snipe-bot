import { createContext, useContext, type ReactNode } from 'react';
import { useWebSocket } from './useWebSocket';
import type { Position, NotificationEvent, ChainStatus, WsEvent } from '../types/api';

interface WebSocketContextValue {
  connected: boolean;
  lastMessage: WsEvent<unknown> | null;
  positions: Position[];
  notifications: NotificationEvent[];
  chainStatuses: ChainStatus[];
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
