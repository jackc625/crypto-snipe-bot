// test/realpath/triage/fixtures/logLevelOrder.ts
// Phase 23 plan 23-13 Task 3 (AUDIT-02): the child process for AUD-DB-005.test.ts. Started only
// through spawnRailedChild with VITEST unset (withVitestEnv: false), so src/config.ts takes its
// production branch and calls dotenv.config(), from a throwaway working folder whose inert .env
// sets LOG_LEVEL=debug (the real .env is never involved; the rails block it underneath).
//
// The first statement deletes LOG_LEVEL: the child's sentinel env sets it (test/.env.test), and
// dotenv never overwrites a key that is already set, so without the delete the file's value could
// never load. Then it imports src/config (what src/bot.ts imports as its first project module) and
// only then src/utils/logger, both dynamically, so nothing loads before the delete. It prints one
// JSON line, { vitest, levelFromConfigFile, loggerLevel }:
//   vitest               whether VITEST was set (must be false, or the proof says nothing about
//                        production);
//   levelFromConfigFile  process.env.LOG_LEVEL after src/config loaded (the .env value, when
//                        dotenv ran);
//   loggerLevel          the level of the logger src/utils/logger.ts created.
// A failed import prints FIXTURE_SETUP_ERROR <why> and exits 3, so the parent reports it as a real
// failure (AC-09).

delete process.env.LOG_LEVEL;

function setupError(why: string): never {
    process.stdout.write(`FIXTURE_SETUP_ERROR ${why}\n`);
    process.exit(3);
}

async function main(): Promise<void> {
    const vitestSet = !!process.env.VITEST;
    try {
        await import('../../../../src/config');
    } catch (err) {
        setupError(`import of src/config failed: ${String((err as Error)?.message ?? err)}`);
    }
    const levelFromConfigFile = process.env.LOG_LEVEL ?? null;
    let loggerLevel: string;
    try {
        const { logger } = await import('../../../../src/utils/logger');
        loggerLevel = logger.level;
    } catch (err) {
        setupError(`import of src/utils/logger failed: ${String((err as Error)?.message ?? err)}`);
    }
    process.stdout.write(`${JSON.stringify({ vitest: vitestSet, levelFromConfigFile, loggerLevel })}\n`);
    process.exit(0);
}

main().catch((err: unknown) => setupError(String((err as Error)?.message ?? err)));
