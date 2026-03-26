// src/api/ws/handler.ts
// WebSocket upgrade handler with session auth.
// Validates the session cookie on upgrade before allowing connection.

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { WebSocketServer } from 'ws';
import { addClient } from './broadcaster';
import { validateSession, SESSION_TTL_MS } from '../middleware/auth';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'api:ws' });

/**
 * Parse cookies from a raw Cookie header string.
 * cookie-parser doesn't run on upgrade requests, so we parse manually.
 */
function parseCookies(header: string | undefined): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!header) return cookies;

    for (const pair of header.split(';')) {
        const [name, ...rest] = pair.trim().split('=');
        if (name) {
            cookies[name.trim()] = rest.join('=').trim();
        }
    }
    return cookies;
}

/**
 * Create an HTTP upgrade handler that validates session cookies
 * before completing the WebSocket handshake.
 *
 * Only accepts upgrades on path '/ws'.
 */
export function handleUpgrade(
    wss: WebSocketServer,
    sessions: Map<string, { createdAt: number }>,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
    return (req, socket, head) => {
        // Only handle /ws path
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (url.pathname !== '/ws') {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        // Parse cookies manually (no cookie-parser on upgrade)
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies['session'];

        if (!token || !validateSession(token)) {
            log.warn('WebSocket upgrade rejected: invalid session');
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            addClient(ws);
            wss.emit('connection', ws, req);
            log.info('WebSocket client connected');
        });
    };
}
