// test/realpath/harness/setup.ts
// Phase 23 plan 23-01 (CHAR-01, AC-02, AC-03): the realpath project's second setup file, after
// test/rails/setup.cjs. It holds the ONLY vi.mock calls of the real-path harness: the logger,
// the notifier, the dashboard broadcaster, axios (relay HTTP and the safety APIs, routed by URL)
// and the Telegram client library. Everything else is real; the fake chain is a transport seam
// (chain.ts installSeams), not a mock.
//
// Factories use plain functions, never vi.fn(): the project's mockReset: true wipes a vi.fn()
// implementation before each test, so logger.child() would return undefined. Factories read the
// shared state on globalThis at call time, because vi.resetModules() re-runs them.

import { afterEach, vi } from 'vitest';
import { harnessState } from './chain';
import { assertAllFaultsFired, assertNoStrays, disposeScenarios, resetTestState } from './world';

harnessState();

vi.mock('../../../src/utils/logger', () => {
    const KEY = Symbol.for('csb.realpath.harness');
    type Sink = { seq: number; logs: Array<{ seq: number; level: string; bindings: Record<string, unknown>; obj: Record<string, unknown> | undefined; msg: string | undefined }> };
    const sink = (): Sink => {
        const s = (globalThis as unknown as Record<symbol, Sink | undefined>)[KEY];
        if (!s) throw new Error('realpath harness: state missing when the logger was called (setup.ts did not run first)');
        return s;
    };
    const make = (bindings: Record<string, unknown>): Record<string, unknown> => {
        const emit =
            (level: string) =>
            (...args: unknown[]): void => {
                const s = sink();
                s.seq += 1;
                const first = args[0];
                const isObj = typeof first === 'object' && first !== null;
                s.logs.push({
                    seq: s.seq,
                    level,
                    bindings,
                    obj: isObj ? (first as Record<string, unknown>) : undefined,
                    msg: isObj ? (typeof args[1] === 'string' ? args[1] : undefined) : typeof first === 'string' ? first : undefined,
                });
            };
        return {
            level: 'info',
            trace: emit('trace'),
            debug: emit('debug'),
            info: emit('info'),
            warn: emit('warn'),
            error: emit('error'),
            fatal: emit('fatal'),
            silent: (): void => {},
            child: (more: Record<string, unknown>) => make({ ...bindings, ...more }),
            isLevelEnabled: (): boolean => true,
            flush: (): void => {},
        };
    };
    return { logger: make({}) };
});

vi.mock('../../../src/utils/notifier', () => {
    const KEY = Symbol.for('csb.realpath.harness');
    const record = (fn: string, args: unknown[]): Promise<void> => {
        const s = (globalThis as unknown as Record<symbol, { seq: number; alerts: Array<{ seq: number; fn: string; args: unknown[] }> } | undefined>)[KEY];
        if (!s) throw new Error('realpath harness: state missing when the notifier was called');
        s.seq += 1;
        s.alerts.push({ seq: s.seq, fn, args });
        return Promise.resolve();
    };
    return {
        sendTelegramAlert: (...args: unknown[]) => record('sendTelegramAlert', args),
        sendChainAlert: (...args: unknown[]) => record('sendChainAlert', args),
        sendCtxAlert: (ctx: { chain?: { name?: string } }, message: unknown) => record('sendCtxAlert', [ctx?.chain?.name, message]),
    };
});

vi.mock('../../../src/api/ws/broadcaster', () => {
    const KEY = Symbol.for('csb.realpath.harness');
    const state = (): { seq: number; broadcasts: Array<{ seq: number; type: string; data: unknown }> } => {
        const s = (globalThis as unknown as Record<symbol, { seq: number; broadcasts: Array<{ seq: number; type: string; data: unknown }> } | undefined>)[KEY];
        if (!s) throw new Error('realpath harness: state missing when the broadcaster was called');
        return s;
    };
    let clients = 0;
    return {
        addClient: (): void => {
            clients += 1;
        },
        removeClient: (): void => {
            clients = Math.max(0, clients - 1);
        },
        getClientCount: (): number => clients,
        broadcast: (type: string, data: unknown): void => {
            const s = state();
            s.seq += 1;
            s.broadcasts.push({ seq: s.seq, type, data });
        },
    };
});

vi.mock('axios', () => {
    const KEY = Symbol.for('csb.realpath.harness');
    type Router = (method: string, url: string, data: unknown, config: unknown) => Promise<unknown>;
    const route = (method: string, url: string, data: unknown, config: unknown): Promise<unknown> => {
        const s = (globalThis as unknown as Record<symbol, { routeAxios: Router | null } | undefined>)[KEY];
        if (!s?.routeAxios) throw new Error(`realpath harness: axios ${method.toUpperCase()} ${url} with no router installed`);
        return s.routeAxios(method, url, data, config);
    };
    const axios: Record<string, unknown> = {
        get: (url: string, config?: unknown) => route('get', url, undefined, config),
        delete: (url: string, config?: unknown) => route('delete', url, undefined, config),
        head: (url: string, config?: unknown) => route('head', url, undefined, config),
        post: (url: string, data?: unknown, config?: unknown) => route('post', url, data, config),
        put: (url: string, data?: unknown, config?: unknown) => route('put', url, data, config),
        patch: (url: string, data?: unknown, config?: unknown) => route('patch', url, data, config),
        request: (config: { method?: string; url: string; data?: unknown }) => route((config.method ?? 'get').toLowerCase(), config.url, config.data, config),
        isAxiosError: (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { isAxiosError?: unknown }).isAxiosError === true,
        defaults: { headers: { common: {} } },
    };
    axios.create = () => axios;
    return { default: axios, ...axios };
});

vi.mock('telegram', () => {
    const KEY = Symbol.for('csb.realpath.harness');
    class TelegramClient {
        readonly session: unknown;
        readonly apiId: unknown;
        readonly apiHash: unknown;
        readonly options: unknown;
        readonly handlers: Array<{ handler: unknown; event: unknown }> = [];
        connected = false;
        constructor(session: unknown, apiId: unknown, apiHash: unknown, options: unknown) {
            this.session = session;
            this.apiId = apiId;
            this.apiHash = apiHash;
            this.options = options;
            const s = (globalThis as unknown as Record<symbol, { telegram: { clients: unknown[] } } | undefined>)[KEY];
            if (!s) throw new Error('realpath harness: state missing when a Telegram client was built');
            s.telegram.clients.push(this);
        }
        async connect(): Promise<boolean> {
            this.connected = true;
            return true;
        }
        async disconnect(): Promise<void> {
            this.connected = false;
        }
        async destroy(): Promise<void> {
            this.connected = false;
        }
        addEventHandler(handler: unknown, event: unknown): void {
            this.handlers.push({ handler, event });
        }
        removeEventHandler(handler: unknown): void {
            const i = this.handlers.findIndex((h) => h.handler === handler);
            if (i >= 0) this.handlers.splice(i, 1);
        }
    }
    return { TelegramClient };
});

vi.mock('telegram/sessions', () => {
    class StringSession {
        readonly value: unknown;
        constructor(value: unknown) {
            this.value = value;
        }
        save(): string {
            return String(this.value ?? '');
        }
    }
    return { StringSession };
});

vi.mock('telegram/events', () => {
    class NewMessage {
        readonly params: unknown;
        constructor(params: unknown) {
            this.params = params;
        }
    }
    return { NewMessage };
});

// One awaited hook, in this order: tear every scenario down, then fail on any stray call
// (AC-03: a caller's catch can swallow the error the fake returned, so the record decides),
// then on any fault or hold that never fired. Per-test state is cleared whatever happened.
afterEach(async () => {
    const errors: unknown[] = [];
    try {
        await disposeScenarios();
    } catch (e) {
        errors.push(e);
    }
    try {
        assertNoStrays();
    } catch (e) {
        errors.push(e);
    }
    try {
        assertAllFaultsFired();
    } catch (e) {
        errors.push(e);
    }
    resetTestState();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `realpath afterEach: ${errors.length} checks failed`);
});
