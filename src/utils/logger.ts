// src/utils/logger.ts
// Structured JSON logger using pino.
// Reads LOG_LEVEL directly from process.env to avoid circular dependency with config.ts.
import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
});
