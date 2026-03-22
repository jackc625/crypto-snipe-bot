import { logger } from "./logger";

const log = logger.child({ module: 'retry' });

export async function retry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delayMs = 1000,
    backoffFactor = 2
): Promise<T> {
    let attempt = 0;

    while (true) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt > retries) throw err;

            const wait = delayMs * backoffFactor ** (attempt - 1);
            log.warn({ attempt, maxRetries: retries, delayMs: wait }, 'Retrying after failure');
            await new Promise(res => setTimeout(res, wait));
        }
    }
}
