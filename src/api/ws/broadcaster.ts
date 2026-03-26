// src/api/ws/broadcaster.ts
// Typed event broadcasting to WebSocket clients.
// Per D-43: sends { type, data, timestamp } JSON events.

import type { WebSocket } from 'ws';

/** Set of authenticated, connected WebSocket clients. */
const authenticatedClients = new Set<WebSocket>();

/**
 * Add a client to the authenticated set.
 * Automatically removes on close.
 */
export function addClient(ws: WebSocket): void {
    authenticatedClients.add(ws);
    ws.on('close', () => {
        authenticatedClients.delete(ws);
    });
}

/**
 * Remove a client from the authenticated set.
 */
export function removeClient(ws: WebSocket): void {
    authenticatedClients.delete(ws);
}

/**
 * Get the number of connected authenticated clients.
 */
export function getClientCount(): number {
    return authenticatedClients.size;
}

/**
 * Broadcast a typed JSON event to all connected, authenticated clients.
 * Skips if no clients are connected. Only sends to OPEN sockets.
 */
export function broadcast(type: string, data: unknown): void {
    if (authenticatedClients.size === 0) return;

    const message = JSON.stringify({ type, data, timestamp: Date.now() });

    for (const client of authenticatedClients) {
        // WebSocket.OPEN = 1
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}
