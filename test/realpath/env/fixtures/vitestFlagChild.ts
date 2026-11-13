// test/realpath/env/fixtures/vitestFlagChild.ts
// Phase 23 plan 23-23 (CHAR-03, AC-27 for the one variable the env matrix never varies in its own
// worker): the config module reads VITEST first (its dotenv guard), and unsetting it inside a Vitest
// worker would make it load .env from the repo root. So each of its five values runs here, in a
// railed child started by test/realpath/env/envMatrix.test.ts through spawnRailedChild with
// withVitestEnv false and a NEW temp directory as its cwd. That directory holds one fake .env whose
// only line sets FAKE_ENV_PROBE_KEY, so the only .env a dotenv load can reach is that fake file.
// Never imported by a test: run only as a child.
//
// Usage: ts-node vitestFlagChild.ts <unset | empty | 0 | abc | valid>
// Prints one last line: {"dotenvLoaded":<boolean>}, whether FAKE_ENV_PROBE_KEY holds the value the
// fake file sets once the config module has loaded.

export {};

/** The value the fake .env in the child's temp cwd sets (envMatrix.test.ts writes the same text). */
const FAKE_ENV_VALUE = 'from-fake-env-file';
const FAKE_ENV_KEY = 'FAKE_ENV_PROBE_KEY';

/** The five values of AC-27, by case name; `valid` is the value a Vitest process holds. */
const FLAG_CASES: Readonly<Record<string, string | undefined>> = {
    unset: undefined,
    empty: '',
    '0': '0',
    abc: 'abc',
    valid: 'true',
};

const caseName = process.argv[2] ?? '';
if (!Object.prototype.hasOwnProperty.call(FLAG_CASES, caseName)) {
    process.stderr.write(`vitestFlagChild: unknown case ${JSON.stringify(caseName)}\n`);
    process.exit(2);
}
// The first thing the child does: set or delete the flag for this case.
const flagValue = FLAG_CASES[caseName];
if (flagValue === undefined) delete process.env.VITEST;
else process.env.VITEST = flagValue;
if (process.env[FAKE_ENV_KEY] !== undefined) {
    process.stderr.write(`vitestFlagChild: ${FAKE_ENV_KEY} was set before the config module loaded\n`);
    process.exit(3);
}
void (async (): Promise<void> => {
    await import('../../../../src/config');
    process.stdout.write(`${JSON.stringify({ dotenvLoaded: process.env[FAKE_ENV_KEY] === FAKE_ENV_VALUE })}\n`);
})().catch((e: unknown) => {
    process.stderr.write(`vitestFlagChild: the config module failed to load: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(4);
});
