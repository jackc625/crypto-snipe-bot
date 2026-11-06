# Phase 22: Safety Rails & Audit - Pattern Map

**Mapped:** 2026-11-06 (HEAD `fc35362`, branch `phase-22-safety-rails-audit`)
**Files analyzed:** 38 new or modified (grouped below)
**Analogs found:** 31 / 38. The other 7 are novel mechanisms; use the RESEARCH.md patterns for them.

All analog paths below are git-tracked (checked with `git ls-files`). Pattern mapping was read-only: no Vitest, npm, or Hardhat command was run, and nothing under `data/` or `.env` was opened.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `test/rails/rails.cjs` (NEW) | test setup / preload | event-driven (patches globals) | `test/fork/setup.ts` + `test/fork/helpers/realMainnetGate.ts` (two-layer tripwire) | partial (same intent, new mechanism) |
| `test/rails/spawnRailedChild.ts` (NEW) | test helper | process spawn | `test/integration/preflightCli.test.ts:26-49` (`runPreflight`) | exact (spawnSync wrapper) |
| `test/.env.test` (NEW) | config | static | `.env.example` (key set must match) | exact |
| `test/rails/env.test.ts`, `dbTripwire.test.ts`, `netDeny.test.ts`, `notifierRefusal.test.ts`, `spawnSites.test.ts`, `envExampleSync.test.ts` (NEW) | test | request-response / source-scan | `test/unit/codeQuality.test.ts` (source scan); `test/integration/api/health.test.ts:28-50` (loopback server) | role-match |
| `test/guards/singleton.test.ts`, `tsconfigCasing.test.ts` (NEW) | test | source-scan / module load | `test/unit/codeQuality.test.ts` | role-match |
| `test/integration/processLock.test.ts`, `dbGuards.test.ts` (NEW) | test (child processes) | process spawn | `test/integration/pauseCli.test.ts:262-296` | exact |
| `test/integration/preflightCli.test.ts` (MOD) | test | process spawn | itself (move `runPreflight` onto `spawnRailedChild`) | n/a |
| `test/integration/pauseCli.test.ts` (MOD, `:282` `{...process.env}`) | test | process spawn | itself | n/a |
| `test/fork/setup.ts` (MOD, `:8-11`) | globalSetup | config | itself | n/a |
| `vitest.config.ts` (MOD) | config | — | itself | n/a |
| `package.json` (MOD scripts) | config | — | itself `:7-17` | n/a |
| `.github/workflows/test.yml` (MOD) | CI config | batch | existing "Ban .todo" step `:20-32` | exact |
| `tsconfig.bot.json`, `dashboard/tsconfig.json` (MOD) | config | — | `tsconfig.json:9` | exact |
| `.env.example` (MOD, add `ETH_FORK_RPC_URL`) | config | — | itself | n/a |
| `src/main.ts` (NEW) | entry point | boot | `scripts/preflight.ts:83-120` (main + exit codes) | role-match |
| `src/bot.ts` (MOD, `:2359-2361`) | entry | boot | itself | n/a |
| `src/utils/processLock.ts` (NEW) | utility | file I/O (OS lock) | `src/utils/db.ts:4-24` (better-sqlite3 open + pragmas) | partial |
| `src/utils/repoRoot.ts` (NEW) | utility | file I/O | none | no analog |
| `src/guards/epoch.ts`, `src/guards/singleton.ts` (NEW) | utility | module-registry | `src/utils/nonceAuthority.ts:43,77-84` (module state + test hook convention) | partial |
| `src/utils/nonceAuthority.ts`, `src/utils/exitManager.ts`, `src/exitEngine.ts`, `src/anti-rug/detector.ts` (MOD: register guard) | service singletons | — | themselves | n/a |
| `src/utils/db.ts` (MOD, `:9-27`) | data layer | CRUD / boot | itself | n/a |
| `src/utils/notifier.ts` (MOD, `:44`, `:80`) | service | request-response | itself (catch path `:49-51`, `:85-87`) | n/a |
| `src/config.ts` (MOD, `:4` dotenv) | config | — | itself | n/a |
| `scripts/backup-state.ts` (NEW) | operator CLI | file I/O + batch | `scripts/check-mythril-report.ts` (no-dep fs CLI, exit codes) | role-match |
| `scripts/forensic-db.ts` (NEW) | operator CLI | file I/O + transform | `scripts/check-mythril-report.ts`; `test/helpers/testDb.ts` (in-memory DB) | role-match |
| `scripts/db-init.ts` (NEW) | operator CLI | file I/O | `scripts/pause.ts` (argv parsing, header doc, exit codes) | role-match |
| `scripts/capture-baselines.ts` (NEW) | operator CLI | batch | `scripts/check-mythril-report.ts` | role-match |
| `scripts/check-vi-mock-paths.ts` (NEW) | CI CLI | source-scan (AST) | `scripts/check-mythril-report.ts` (CI gate exit-code contract) | role-match |
| `scripts/verify-prod-untouched.ts` (NEW) | operator CLI | file I/O | `scripts/check-mythril-report.ts` | role-match |
| `scripts/nac01-exact-value-check.ts` (NEW, D-22) | operator CLI | file I/O | `scripts/pause.ts:13-16` (never-log-secret invariant) | role-match |
| `test/fixtures/viMockGate/*` (NEW) | fixture | static | `test/fixtures/` (existing dir) | role-match |
| `.planning/audit/tools/render.ts`, `check.ts` (NEW) | planning tooling | transform | none (no tooling exists under `.planning/`) | no analog |
| `.planning/audit/{findings,ledger,sweep,thresholds,decisions}/*` (NEW data) | data | static | none | no analog |
| `.planning/baselines/{before,after}/*` (NEW data) | data | static | none | no analog |
| `.gitignore`, `ignition/.gitignore`, `.gitattributes` (MOD, follow-up to OD-21) | config | — | themselves | n/a |
| `README.md`, `.planning/STATE.md` (MOD, start command) | docs | — | — | n/a |

## Pattern Assignments

### `test/rails/rails.cjs` (setup layer + `--require` preload)

**Analog:** `test/fork/setup.ts` with `test/fork/helpers/realMainnetGate.ts`. This is the existing D-GATE-BOTH-LAYERS precedent. Copy its **header-comment style**, which names both layers, the D-ROLLBACK "no bypass" rule, and the observable effect.

`realMainnetGate.ts:1-17` header to mirror:
```ts
// Phase 21 plan 21-02 Task 1 — EXIT-LIVE-08 test-safety gate (D-GATE-BOTH-LAYERS layer b).
// ... This is PURE test infrastructure (D-ROLLBACK): there is no production-code change and
// no bypass beyond the explicit ALLOW_REAL_MAINNET=1 opt-in.
// Two layers enforce the guard (D-GATE-BOTH-LAYERS):
//   (a) a GLOBAL tripwire in test/fork/setup.ts ...
//   (b) the per-test decorator `requireRealMainnetGate()` exported here ...
```
The rails go further: **no opt-in env var at all** (NAC-05).

Fail-closed throw shape for the DB tripwire, from `setup.ts:53-60`. Use a distinctive code (`RAIL_DB_TRIPWIRE`) and name what was protected:
```ts
throw new Error(
    `Fork globalSetup aborted: the fork node reports real-mainnet chainId 1 ` +
        `without ALLOW_REAL_MAINNET=1 — every fork test is blocked to protect the ` +
        `prod wallet. ${(err as Error).message}`,
);
```
The mechanism has no repo analog. Use RESEARCH.md Pattern 2 (wrap the addon `Database` found in `require.cache`), Pattern 3 (`net.Socket.prototype.connect`, test `!!options.path`, destroy with `process.nextTick`), and Pattern 1 (idempotent through a `Symbol.for` flag). Must be plain CommonJS so that `--require` works. Network deny is skipped for the fork project only.

Sentinel key: do **not** reuse `FORK_ONLY_TEST_KEY` (`realMainnetGate.ts:32-33`, Hardhat #0). D-02 requires a different throwaway key.

---

### `test/rails/spawnRailedChild.ts`

**Analog:** `test/integration/preflightCli.test.ts:26-49`
```ts
const repoRoot = path.resolve(__dirname, '..', '..');
const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

function runPreflight(extraEnv: Record<string, string> = {}): CliResult {
    const result = spawnSync(npxCmd, ['ts-node', 'scripts/preflight.ts'], {
        cwd: repoRoot,
        env: { ...process.env, ...extraEnv },   // <-- the pattern to REPLACE
        shell: true,
        encoding: 'utf8',
        timeout: 60_000,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
```
Keep: `npxCmd` selection, `shell: true`, `encoding`, `timeout`, and the `CliResult` shape. Change:
- the env comes from the scrubbed sentinel env plus the Windows essentials (`SystemRoot`, `ComSpec`, `PATHEXT`, `PATH` with the Node 22 dir first, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `TEMP`, `TMP`)
- set `VITEST`
- set `NODE_OPTIONS = '--require ' + JSON.stringify(railsAbsPath)`
- run `npx --no ts-node ...`

Both the sync and the async (`spawn`) forms are needed, because the lock tests need live holders.

---

### `test/integration/processLock.test.ts`, `test/integration/dbGuards.test.ts`

**Analog:** `test/integration/pauseCli.test.ts:262-296`. This shows the per-test timeout and the subprocess assertion style:
```ts
it('Test 4: ...', () => {
    const result = spawnSync(npxCmd, ['ts-node', 'scripts/pause.ts', '--reason', 'should-not-reach'], {
        cwd: repoRoot, env: childEnv, shell: true, encoding: 'utf8', timeout: 60_000,
    });
    expect(result.status).toBe(1);
    const combined = (result.stdout ?? '') + (result.stderr ?? '');
    expect(combined).toMatch(/DASHBOARD_API_KEY not set/i);
}, 90_000, // ts-node cold start on Windows ~3-5s
);
```
Route every spawn through `spawnRailedChild`. Pass the lock directory as a **function parameter** to a temp dir; never use an env var. Use a barrier and check whether hold intervals overlap for AC-23c. Add a `--expose-gc` holder for STL-5. `dbGuards` needs a child **without** `VITEST`, running against a temp fake repo root (a `package.json` named `crypto-snipe-bot`).

---

### `test/rails/*.test.ts` and `test/guards/*.test.ts` (source scans and rail RED tests)

**Source-scan analog:** `test/unit/codeQuality.test.ts:13-26` (`collectTsFiles`) and `:33-47`:
```ts
const files = collectTsFiles(srcDir, ['scripts']);
const matches: string[] = [];
for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    if (pattern.test(content)) matches.push(file.replace(process.cwd(), ''));
}
expect(matches).toHaveLength(0);
```
Apply this to `spawnSites.test.ts`, upgraded to a TypeScript AST scan per D-03 (with `test/fork/setup.ts` as the only exemption). Also apply it to `tsconfigCasing.test.ts`, the `main.ts` import-order source test, and `envExampleSync.test.ts`. Static-grep precedent: `pauseCli.test.ts:303-313` (apiKey never logged).

**Loopback-server analog for `netDeny.test.ts`** (the loopback must stay allowed): `test/integration/api/health.test.ts:28-50`
```ts
const server = http.createServer(app);
server.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    const req = http.request({ hostname: '127.0.0.1', port: addr.port, path: '/health', method: 'GET' }, ...);
```
Use `192.0.2.1` as the non-loopback target, never a real host.

**In-memory DB analog** (must keep working under the tripwire): `test/helpers/testDb.ts:19-25` (`new Database(':memory:')`).

---

### `test/fork/setup.ts` (MOD)
Current `:8-11`:
```ts
const rpcUrl = process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL;
if (!rpcUrl) {
    throw new Error('ETH_FORK_RPC_URL or ALCHEMY_URL env var required for fork tests');
}
```
Drop the `ALCHEMY_URL` fallback. The error must name only `ETH_FORK_RPC_URL` and say it is read from the shell. This file stays the single exempt spawner (`:14,16,75`).

---

### `vitest.config.ts` (MOD)
- Remove `:2` `import { config } from 'dotenv';` and the `:4` `config();` call.
- Add `envDir: false`.
- Add `setupFiles: ['test/rails/rails.cjs']` inside each of the three project blocks (`unit` `:11-17`, `integration` `:21-27`, `fork` `:31-45`). Keep `extends: true`, `mockReset: true`, and the fork `fileParallelism: false` and its comment.

### `package.json` scripts (MOD)
Existing naming at `:9-17` is `test:<project>` and bare verbs run via `ts-node scripts/<name>.ts`. Pattern:
```json
"test": "vitest run --reporter=verbose",            // -> "vitest run --project unit --project integration --reporter=verbose"
"preflight": "ts-node scripts/preflight.ts",
```
New scripts: `start` → `ts-node src/main.ts`, `db:init`, `backup:state`, `baselines:capture`, and `check:vi-mock` (the research uses that name). `test:all` currently equals `test`; after the change it remains the all-project form, which the planner should note.

### `.github/workflows/test.yml` (MOD)
Analog: the step at `:20-32`, a named step with a comment block citing the decision ID and `exit 1` on violation. Add `- name: vi.mock specifier gate (SAFE-06)` / `run: npm run check:vi-mock` after `npm run test:integration` (`:19`). Node stays `'22'` (`:15`).

### `tsconfig.bot.json`, `dashboard/tsconfig.json` (MOD)
Copy `"forceConsistentCasingInFileNames": true` from `tsconfig.json:9` into `compilerOptions`. `tsconfig.bot.json` currently has 8 options and no casing flag.

---

### `src/main.ts` (NEW entry)
**Analog:** `scripts/preflight.ts:83-120`, which has a `main()` and the 0/1/2 exit-code contract:
```ts
main().catch((err) => {
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Preflight CLI crashed');
    process.exit(2);
});
```
**Deviation (required):** no top-level static imports of stateful modules. TypeScript turns `import` into a top-of-file `require`, which runs before the lock. Order: `dotenv`, then derive the address from `PRIVATE_KEY` (lowercased), then `acquire()` synchronously, pin the handle on `globalThis[Symbol.for('crypto-snipe-bot.processLock')]`, then `require('./bot').startMultiChainBot()`. Do not import the `logger` before the lock either. Refuse boot on any lock error (NAC-07).

### `src/bot.ts` (MOD `:2359-2361`)
Current:
```ts
if (require.main === module) {
    startMultiChainBot();
}
```
Replace this with a refusal that prints "start via src/main.ts" and exits non-zero.

### `src/utils/processLock.ts` (NEW)
Partial analog: `src/utils/db.ts:4,17-24` (better-sqlite3 default import, then construct, then pragmas). Use the RESEARCH.md Pattern 5 code verbatim (`timeout: 0`, `locking_mode = EXCLUSIVE`, `BEGIN EXCLUSIVE`, pin). The lock directory is a parameter. Export `acquire(dir, address)` and `tryAcquireThenRelease(dir, address)`.

### `src/guards/singleton.ts` + `epoch.ts` (NEW) and the four guarded modules
Convention analog: `src/utils/nonceAuthority.ts:77-84`. The test-only hooks have an underscore prefix and only reset state:
```ts
/** Test-only hook ... Underscore prefix signals test-only (mirrors `_resetForTesting` in
 * circuitBreaker.ts / `_resetRegistryForTesting` in detector.ts). */
export function _resetNonceChainsForTesting(): void { chains.clear(); }
```
The guard must **not** become a reset or bypass hook, and must not be wired into these hooks. Registration sites (place the call next to the module-state declarations):
- `src/utils/nonceAuthority.ts:43`: `const chains = new Map<string, Promise<unknown>>();`
- `src/utils/exitManager.ts:14`, `:53`, `:104`
- `src/exitEngine.ts:1421`: `const exitWorker = new ExitWorker();`
- `src/anti-rug/detector.ts:192`, `:197`, `:247`

The key comes from `fs.realpathSync.native(__filename)`, and the raw identity is the un-normalized `__filename`.

### `src/utils/db.ts` (MOD `:9-27`)
Current import-time sequence, which the guards must precede:
```ts
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.db');   // :9
if (!fs.existsSync(dbDir)) { fs.mkdirSync(dbDir, { recursive: true }); }             // :13-15
const db = new Database(DB_PATH);                                                    // :17
db.pragma('journal_mode = WAL');                                                     // :20
const CURRENT_SCHEMA_VERSION = 7;                                                    // :27
```
Insert these steps between `:9` and `:17`, in order:
1. Anchor the path to the repo root (`repoRoot.ts`).
2. Under Vitest, throw if the path is inside `<repo>/data/`, and use a per-worker temp file when the path is unset or `''`.
3. Outside Vitest, refuse a missing or 0-byte file, naming the absolute path. Remove the silent `mkdirSync`.
4. Run the read-only probe `new Database(p,{readonly:true,fileMustExist:true})` and read `user_version`, then refuse `0` or `> CURRENT`.

Move `CURRENT_SCHEMA_VERSION` above the probe. `db.ts` imports only `./logger`, so it is safe to guard early.

### `src/utils/notifier.ts` (MOD)
Per amended D-04, refuse **through the existing catch path**: at `:44` (`sendTelegramAlert`) and `:80` (`sendCtxAlert`), under VITEST, raise or route a rail refusal so it is handled by the existing:
```ts
} catch (error: any) {
    log.warn({ err: error }, 'Telegram alert error');
}
```
(`:49-51`, `:85-87`). The broadcast at `:54-59` and `:91-97` must still run. Never use the early-return "skipped" branch at `:38-41`. Append the refusal to the rail ledger. Note that `:10` builds `TELEGRAM_API` at import time with the token in it, so the refusal must happen before any `axios.post`.

### `src/config.ts:4`, `src/utils/notifier.ts:6` (dotenv sites)
Pattern: `dotenv.config();`. Add a VITEST-gated skip or a block, and keep dotenv 17 non-overwrite semantics in mind.

---

### `scripts/backup-state.ts`, `forensic-db.ts`, `capture-baselines.ts`, `check-vi-mock-paths.ts`, `verify-prod-untouched.ts`
**Analog:** `scripts/check-mythril-report.ts`.
- **Header:** the `:1-24` header block lists purpose, usage, a **Behavior** table mapping each input to an exit code, and "Zero new npm deps".
- **Imports:** `:26` `import * as fs from 'fs';`. Node built-ins only.
- **Core:** a synchronous `main(): void` at `:45-60`:
```ts
const reportPath = process.argv[2];
if (!reportPath) { console.error('Usage: ts-node check-mythril-report.ts <report.json>'); process.exit(1); }
let raw: string;
try { raw = fs.readFileSync(reportPath, 'utf8'); }
catch (e) { const msg = e instanceof Error ? e.message : String(e);
            console.error(`check-mythril-report: failed to read '${reportPath}': ${msg}`); process.exit(1); }
```
Additions for every new Phase 22 script:
- Put `if (process.versions.modules !== '127') { console.error(...); process.exit(1); }` as the first statement (D-21).
- Do **not** call `dotenv.config()`. Unlike `pause.ts:32` and `preflight.ts:26`, these scripts must not load `.env`.
- Never import `src/utils/db` (import-time side effects).
- `backup-state.ts` copies and hashes raw bytes only, with `--self-check` and `--verify <dir>` modes.
- `forensic-db.ts` uses RESEARCH.md §Forensic in-memory image (header bytes 18-19 patch).

### `scripts/db-init.ts`, `scripts/nac01-exact-value-check.ts`
**Analog:** `scripts/pause.ts`.
- **Header:** `:1-26` with exit codes 0/1/2, a T-mitigation note, and usage.
- **Argv parsing:** `:63-70` `getReasonArg` (both `--flag value` and `--flag=value`). Use it for `--replace-empty`.
- **Secret invariant:** `:13-16` "NEVER passed as a CLI argument ... NEVER logged". Apply it to the NAC-01 check, which prints only per-key yes/no lines. A matching static-grep test, as in `pauseCli.test.ts:303-313`, should assert that no log or console call references the secret values.

`db-init.ts` resolves the path through the **same** function `db.ts` uses: export it from `repoRoot.ts` or `db` path helper, and do not duplicate it.

---

## Shared Patterns

### Fail-closed error naming the protected thing
**Source:** `test/fork/setup.ts:53-60`, `realMainnetGate.ts:69-74`
**Apply to:** DB tripwire, schema/refuse-create guards, singleton guard, process lock, and the fork RPC error. The message states what was refused and why ("this guard protects the prod wallet ...").

### Decision-ID comments
**Source:** `realMainnetGate.ts:1-17`, `test.yml:22-28`
**Apply to:** every new rail and guard. Cite SAFE-0x and D-xx in the header.

### Underscore test hooks reset state and never bypass
**Source:** `nonceAuthority.ts:77-84`, `circuitBreaker.ts:228-232`, `detector.ts:301`
**Apply to:** guarded singletons. No new `_disableGuardForTesting`-style hook (NAC-05).

### CLI exit-code contract
**Source:** `scripts/preflight.ts:111-120` and `check-mythril-report.ts:16-21`. 0 means ok, 1 means a check failed or input was bad, 2 means an uncaught crash.
**Apply to:** all new scripts and `src/main.ts`.

### Windows subprocess handling
**Source:** `preflightCli.test.ts:27-29` (`npx.cmd`, `shell: true`) and `test/fork/setup.ts:73-86` (`taskkill /F /T /PID` tree kill)
**Apply to:** `spawnRailedChild`, and processLock force-kill tests (AC-23b).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `test/rails/rails.cjs` mechanism (addon wrap, socket deny, ledger) | test setup | event-driven | No global patching exists in the repo. Use RESEARCH.md Patterns 1-3 |
| `src/utils/repoRoot.ts` | utility | file I/O | No walk-up resolver exists. Use CONTEXT "Repo-root anchoring" |
| `src/guards/singleton.ts` / `epoch.ts` rules | utility | registry | New concept. Use D-05 and STL-4 |
| `scripts/check-vi-mock-paths.ts` AST core | CI script | source-scan | No TypeScript compiler API use in the repo. Use RESEARCH.md Pattern 7 |
| `.planning/audit/tools/{render,check}.ts` | planning tooling | transform | **No tooling scripts exist under `.planning/`** (`git ls-files .planning` has no `.ts/.js/.sh`). Follow the `check-mythril-report.ts` CLI shape, and keep the files inside `.planning/` (AC-33) |
| `.planning/audit/**` data, `.planning/baselines/**` | data | static | New. The schema comes from the AC-31/34/37/38 fields |

## Metadata

**Analog search scope:** `test/fork/`, `test/integration/`, `test/unit/`, `test/helpers/`, `scripts/`, `src/utils/`, `src/anti-rug/`, `src/bot.ts`, `vitest.config.ts`, `package.json`, `tsconfig*.json`, `.github/workflows/test.yml`, `.planning/` (searched for tooling and found none)
**Files read:** 16
**Pattern extraction date:** 2026-11-06
