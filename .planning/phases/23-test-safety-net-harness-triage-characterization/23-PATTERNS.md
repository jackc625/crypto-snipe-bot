# Phase 23: Test Safety Net (Harness, Triage, Characterization) - Pattern Map

**Mapped:** 2026-11-09
**Files analyzed:** 30 entries (individual files, or one family of same-shaped files such as "one triage test per root cause")
**Analogs found:** 24 / 30 (the other 6 have no analog; use the RESEARCH.md prototypes named below)

New paths follow the layout suggested in 23-RESEARCH.md §Recommended Project Structure. Names are at the planner's discretion.

All analog paths below were checked with `git ls-files`. Line numbers are from HEAD `6122bf7`.

## Read First: Traps Found While Mapping

These affect plan content. Items 1 to 4 are not in RESEARCH.md.

1. **CI does not run `npm test`.** `.github/workflows/test.yml:18-19` calls `npm run test:unit` and `npm run test:integration` separately. Adding `--project realpath` to the `test` script (`package.json:10`) does nothing for CI. D-09 needs its own `npm run test:realpath` step.
2. **The census self-test has a path tied to its folder.** `signing-census.ts:1361` resolves `node_modules` with `path.resolve(__dirname, '..', '..', '..', 'node_modules')`. In `scripts/` that must be one `..`, or the self-test exits 2 with "ethers types not found".
3. **The vi.mock walker's helpers are private.** `collectViBindings`, `mockMethodOf` and `literalSpecifier` (`check-vi-mock-paths.ts:143,173,194`) are not exported. Only `checkViMockPaths` and `collectSourceFiles` are. The mock-list check must either export them (a `scripts/` change, not `src/`) or copy them. Exporting is better, because the two gates then cannot drift apart. Importing the module is safe: `main()` is behind `require.main === module` (line 291).
4. **The walker sees only `mock`, `doMock`, `unmock` and `doUnmock`** (`MOCK_METHODS`, line 69). `vi.spyOn` on a module object or `vi.stubGlobal` would bypass an AC-02 list built only from this walker. The env matrix legitimately spies on `process.exit`, so the planner must decide what AC-02 covers beyond `vi.mock`.
5. **Existing "real-looking" tests are anti-analogs.** `test/integration/wsReconnect.test.ts:41-68` and `test/helpers/mockProvider.ts` replace ethers, which is exactly what this phase exists to avoid. Do not copy provider or contract shapes from them.
6. **`SAFE_EXEC_RECEIVERS` gate:** in harness code the better-sqlite3 handle must be named `db` (`test/unit/rails/spawnSites.test.ts:41`). The same gate bans `child_process` under `test/`, so all git calls live in `scripts/`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `vitest.config.ts` (modify) | config | n/a | its own `integration` project, lines 26-38 | exact |
| `package.json` (modify) | config | n/a | lines 10-22 | exact |
| `.github/workflows/test.yml` (modify) | config | batch | its own lines 12, 20-25 | exact |
| `test/realpath/harness/seams.ts` | test utility | request-response | RESEARCH Pattern 1; `railsIntegration.test.ts:17-23` for `createRequire` | partial |
| `test/realpath/harness/fakeNode.ts` | test utility | request-response | none | none |
| `test/realpath/harness/fakeWebSocket.ts` | test utility | event-driven | none | none |
| `test/realpath/harness/routers.ts` (relay + axios) | test utility | request-response | none (RESEARCH Pattern 3, Pitfall 10) | none |
| `test/realpath/harness/clock.ts` | test utility | event-driven | `midRunWalletCheck.test.ts:228-249` | partial |
| `test/realpath/harness/dbCapture.ts` + timeline | test utility | event-driven | none | none |
| `test/realpath/harness/serializer.ts` (compare and update) | test utility | transform, file-I/O | none | none |
| `test/realpath/harness/knownBug.ts` | test utility | transform | none | none |
| `test/realpath/harness/reset.ts` (whole-graph reset) | test utility | transform | `wsReconnect.test.ts:18-20,70` for reset-then-import only | partial |
| `test/realpath/harness.test.ts` | test | request-response | `test/integration/rails/railsIntegration.test.ts` | role-match |
| `test/realpath/migrations/*.test.ts` + frozen v4 fixture | test, migration | CRUD | `test/helpers/testDb.ts` (the v4 schema); `dbSchema.ts:13-16` | role-match |
| `test/realpath/triage/<LEAD-ID>.test.ts` (route H, H-race) | test | event-driven | harness + `knownBug` (no earlier analog) | partial |
| `test/realpath/triage/*` (route C, crash-class) + child fixtures | test | request-response | `test/integration/directEntryGuard.test.ts` + `test/integration/fixtures/` | exact |
| `test/realpath/scenarios/*.test.ts` | test | event-driven | harness (no earlier analog) | partial |
| `test/realpath/recordings/.gitattributes` | config | n/a | `.planning/audit/.gitattributes` | exact |
| `test/realpath/env/*.test.ts` + snapshot | test | batch, transform | `test/unit/configEnvVar.test.ts` | role-match |
| `test/realpath/ordering/*.test.ts` | test | event-driven | `test/integration/midRunWalletCheck.test.ts:239-251` | role-match |
| `scripts/check-realpath-mocks.ts` | utility (gate) | batch | `scripts/check-vi-mock-paths.ts` | exact |
| `scripts/check-signing-census.ts` | utility (gate) | batch | `.planning/audit/tools/signing-census.ts` | exact (promotion) |
| `scripts/check-commit-taxonomy.ts` | utility (gate) | batch | `.planning/audit/tools/seal-verify.ts` (git helpers, self-test) | role-match |
| Gate wrapper tests (`test/unit/...`) | test | request-response | `test/unit/viMockGate.test.ts`; `test/integration/backupState.test.ts` | exact |
| `test/helpers/testDb.ts` (modify) | test utility | CRUD | `src/utils/dbSchema.ts:13` | exact |
| `test/unit/db.test.ts:76-79`, `test/unit/helpers.smoke.test.ts:32-34` (modify, F5) | test | CRUD | themselves | exact |
| `.planning/audit/tools/check.ts` (modify, D-21) | utility (gate) | batch | its own lines 320 and 1246-1295 | exact |
| `.planning/audit/tools/seal-verify.ts` (modify, D-19) + successor seal record | utility (gate) | batch | its own lines 512-516 and 569-609 | exact |
| D-11 operator report generator | utility | transform | none specific; input comes from `knownBug` `task.meta` via the JSON reporter | partial |
| 11 source-text test conversions (AC-37) | test | varies | `test/unit/bot/twoStageSigint.test.ts` (behavior tests in the same file) | role-match |

## Pattern Assignments

### `vitest.config.ts` (config)

**Analog:** its own `integration` project, lines 26-38. Copy it and add the alias from RESEARCH Pattern 1.

```typescript
{
    extends: true,
    test: {
        name: 'integration',
        include: ['test/integration/**/*.test.ts'],
        testTimeout: 15000,
        environment: 'node',
        mockReset: true,
        setupFiles: ['test/rails/setup.cjs'],
        globalSetup: ['test/rails/ledgerRun.ts'],
        env: { CSB_RAIL_PROJECT: 'integration' },
    },
},
```

The file needs a `path` import for the alias. It has none today (line 1 imports only `defineConfig`). Do not add a coverage or env-file change: lines 3-8 record the rule that the main process loads no `.env`.

---

### `package.json` and `.github/workflows/test.yml` (config)

`package.json` script shape (lines 10-22):
```json
"test": "vitest run --project unit --project integration --reporter=verbose",
"test:integration": "vitest run --project integration --reporter=verbose",
"check:vi-mock": "ts-node scripts/check-vi-mock-paths.ts"
```

Workflow gate step shape (`test.yml:20-25`). The comment states what the gate protects:
```yaml
- name: vi.mock specifier gate (SAFE-06)
  # SAFE-06: a moved file must not turn a mock into a silent no-op. ...
  run: npm run check:vi-mock
```

Changes: `actions/checkout@v4` at line 12 needs `with: fetch-depth: 0`, and only in the `test` job. Add `npm run test:realpath` after line 19 (trap 1). Add the mock-list, census and commit-check gates after line 25.

---

### `test/realpath/harness/seams.ts` (test utility)

**Primary source:** RESEARCH Pattern 1 (`installSeams`, run and verified).
**Repo convention for loading a CJS copy from a test** (`test/integration/rails/railsIntegration.test.ts:17-23`):
```typescript
const req = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = req('../../rails/core.cjs') as {
    railsStatus(): { installed: boolean; mode: string; project: string; repoRoot: string; netDenyInstalled: boolean };
    ...
};
```
Use the same typed-cast style for `req('ethers')`. `railsStatus().project` should equal `'realpath'` in the harness's own rail assertion, copying lines 45-51.

---

### `test/realpath/harness/clock.ts` (test utility)

**Analog for lifecycle only:** `test/integration/midRunWalletCheck.test.ts:228-237`
```typescript
beforeEach(() => {
    vi.useFakeTimers();
    ...
});
afterEach(() => {
    vi.useRealTimers();
    ...
});
```
The bare `vi.useFakeTimers()` is not sufficient. Use RESEARCH Pattern 2's explicit `TO_FAKE`, which includes `performance`, plus `stepUntil` and `expectStillPending`.

---

### `test/realpath/harness/reset.ts` (test utility)

**Analog for ordering only:** `test/integration/wsReconnect.test.ts:18-20` (`vi.resetModules()` in `beforeEach`) and line 70 (dynamic import afterwards). Everything else in that file is an anti-analog.

Required order, from RESEARCH Flag 5 and Pitfall 5, as one helper: `closeDb()` on the old graph, then `vi.resetModules()`, then import, then `installDbCapture(db, ...)`. Obtain `db` through the existing export (`src/utils/db.ts:554-555`). Do not add a getter (F2).

---

### `test/realpath/harness.test.ts` (test)

**Analog:** `test/integration/rails/railsIntegration.test.ts`. Header comment naming the plan and requirement (lines 1-4), then a rail-status assertion first (lines 45-51):
```typescript
it('rails installed in mode full for the integration project', () => {
    const st = core.railsStatus();
    expect(st.installed).toBe(true);
    expect(st.mode).toBe('full');
    expect(st.project).toBe('integration');
    expect(st.netDenyInstalled).toBe(true);
});
```
Loopback server shape for the D-02 real-socket tests (lines 102-109):
```typescript
const server = http.createServer((_q, r) => r.end('int-loopback-ok'));
await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
try {
    const port = (server.address() as net.AddressInfo).port;
    ...
} finally {
    await new Promise<void>((r) => server.close(() => r()));
}
```

Real ethers encoding of chain data has one small precedent: `test/integration/anti-rug/multiSignalEnd2End.test.ts:291` (`ethers.AbiCoder.defaultAbiCoder().encode(`).

---

### `test/realpath/migrations/*.test.ts` + frozen v4 fixture (test, migration)

**v4 fixture source:** the body of `test/helpers/testDb.ts:28-69`, frozen before that helper changes. Copy it first, because the same plan removes it from the helper. AC-05 needs it as a historic fixture (RESEARCH Pitfall 9).

**Entry point** (`src/utils/dbSchema.ts:11-14`):
```typescript
export const CURRENT_SCHEMA_VERSION = 7;

export function migrateSchema(db: Database.Database): void {
    const version = db.pragma('user_version', { simple: true }) as number;
```
Compare `PRAGMA table_info`, `index_list` and `foreign_key_list`, and compare SQL text only with whitespace removed (E9).

---

### `test/helpers/testDb.ts` (modify) and the two F5 edits

Keep the name, signature and pragmas (lines 19-25). Replace lines 27-69 with `migrateSchema(db)`, and update the header comments at lines 3 and 11-17, which state `user_version=4`.

```typescript
export function createTestDb(): Database.Database {
    const db = new Database(':memory:');

    // Match production pragmas (WAL is issued for parity but :memory: uses journal_mode=memory)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
```

Both F5 edits assert `CURRENT_SCHEMA_VERSION` in place of `4`: `test/unit/db.test.ts:76-79` (also rename the test, "Schema v4: ...") and `test/unit/helpers.smoke.test.ts:32-34` (also fix the comment). The plan summary must name them under AC-49.

---

### `test/realpath/triage/*` crash-class (route C: AUD-ANTIRUG-002, AUD-API-008, AUD-TX-009, AUD-BUY-005)

**Analog:** `test/integration/directEntryGuard.test.ts:11-30,33-44`, plus a small fixture entry as in `test/integration/fixtures/directEntryFixture.ts`.
```typescript
function runFixture(name: string, marker: string): CliResult {
    return spawnRailedChild('npx', ['ts-node', `test/integration/fixtures/${name}`, marker], { timeoutMs: 110_000 });
}

afterEach(() => {
    for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
...
it(
    'a direct start refuses before any later import runs',
    () => {
        const marker = markerPath();
        const r = runFixture('directEntryFixture.ts', marker);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('Refusing to start');
        ...
    },
    TEST_TIMEOUT_MS,
);
```
Also copy that file's **control case** (lines 46-50): a companion fixture proving the test can see the failure. It meets the "RED-proven real-path test" requirement from project history.

Limits: `envOverrides` keys must exist in `test/.env.test`, and the command must be `node` or `npx` (`spawnRailedChild.ts:15-22,237`). The fixture folder is the planner's choice, but must not contain `.test.ts` names.

---

### `test/realpath/triage/*` routes H and H-race, and `test/realpath/scenarios/*`

No earlier analog: nothing in the repo drives real ethers on a fake chain. Use the harness modules with RESEARCH Pattern 4 (`knownBug`, called once per entry under AC-11). One file per root cause (D-10), and the finding ID must appear in a form the D-21 check finds. `task.meta.knownBug.id` is the proven carrier (E10).

---

### `test/realpath/env/*.test.ts` (test, batch)

**Analog:** `test/unit/configEnvVar.test.ts`, for the logger-capture shape (lines 17-31, 62) and reset-per-case (lines 64-65).
```typescript
vi.mock('../../src/utils/logger', () => ({
    logger: {
        child: () => ({
            info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), fatal: vi.fn(),
        }),
        ...
    },
}));
```
**Do not copy two things.**
- The module-level `vi.spyOn(process, 'exit')` at lines 54-56: under `mockReset` it must be installed per case (RESEARCH E6c, Pattern 7).
- `vi.fn()` where an implementation has to survive reset. Use plain functions, as RESEARCH's anti-patterns list says.

`REQUIRED_ENV` (lines 34-43) is too small for the fully valid baseline. Build that from `test/.env.test` plus all four chains and the three honeypot addresses (Flag 6). Evaluation body: RESEARCH Pattern 7, extended with `src/riskManager.ts` (D-16, Amendment A-1).

---

### `test/realpath/ordering/*.test.ts` (test, event-driven)

**Analog for shape:** `test/integration/midRunWalletCheck.test.ts:245-249`
```typescript
const bot = await import('../../src/bot');
await bot.startMultiChainBot();

const callsBefore = checkWalletBalanceMock.mock.calls.length;
await vi.advanceTimersByTimeAsync(300_000);
```
Call boot this way, but on the fake chain and without that file's mocks. Keep all boot tests in one file with `DASHBOARD_PORT=0` (Open Question 3). Singleton-identity proof: `SINGLETON_DUPLICATE` from `src/guards/singleton.ts`, with `test/rails/probes/duplicateLoadProbe.cjs` as the existing probe.

---

### `scripts/check-realpath-mocks.ts` (gate)

**Analog:** `scripts/check-vi-mock-paths.ts`. Copy the following.

| Element | Lines |
|---|---|
| Header documenting usage, decision rule, exit codes | 1-37 |
| ABI guard before imports | 39-44 |
| Binding-aware walk with `ts.forEachChild` | 216-231 |
| `main()`: one line per violation, then a summary | 272-289 |
| Exit codes: 0 clean, 1 violation, 2 usage or "checked nothing" | 28-31, 278 |

```typescript
const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && mockMethodOf(node.expression, bindings) !== undefined) {
        callsChecked += 1;
        const call = node.expression.getText(sf);
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const specifier = literalSpecifier(node.arguments[0]);
        ...
    }
    ts.forEachChild(node, visit);
};
```
Resolve each specifier to a real file and compare against the allow-list by resolved path, as `resolves()` does at lines 119-130, so that `../../src/utils/logger` and an aliased path cannot differ. A non-literal specifier must be a violation. See traps 3 and 4. The AC-02 list is: logger, notifier, broadcaster, relay HTTP (`axios`), clock, and Telegram (`telegram`, `telegram/sessions`, `telegram/events`, per Pitfall 10).

---

### `scripts/check-signing-census.ts` (gate, promotion)

**Source:** `.planning/audit/tools/signing-census.ts` (1451 lines). The original stays unchanged (D-20).

Required changes:
- Line 1361: fix the `node_modules` depth (trap 2).
- Lines 1429-1430: remove the refusals for a checkout, and add a self-test that `.env` and `data/` are never opened (Flag 7).
- Line 1426: `--sha` and `--out` no longer fit a CI gate. The command compares against the exception file and exits 0 or 1.
- Exception format: `file|enclosing|call` **plus a count** (Flag 7: 23 sites reduce to 19 keys), with a separate `excluded` section for the two non-signing sites (F3, Open Question 4). An `unknown` lock status must fail.

Keep the CLI wrapper exactly (lines 1443-1450):
```typescript
if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`signing-census: ${e instanceof UsageError ? '' : 'crash: '}${e instanceof Error ? e.stack ?? e.message : String(e)}`);
        process.exitCode = 2;
    }
}
```
Keep the self-test's temp-project build (lines 1366-1376) and its `SELF-TEST PASS n of n` output (line 1415).

---

### `scripts/check-commit-taxonomy.ts` (gate)

**Analog:** `.planning/audit/tools/seal-verify.ts`, for git access and throwaway-repo self-tests. Commit messages are untrusted, so these argument-array helpers are required (lines 109-129):
```typescript
function readGitEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
    env.GIT_TERMINAL_PROMPT = '0';
    env.GIT_OPTIONAL_LOCKS = '0';
    return env;
}

function gitOut(repo: string, args: string[]): Buffer {
    const r = cp.spawnSync('git', args, { cwd: repo, env: readGitEnv(), windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw new Error(`git did not run: ${r.error.message}`);
    if (r.status !== 0) throw new Error(`git ${args.slice(0, 2).join(' ')} failed (exit ${r.status})`);
    return r.stdout;
}
```
Throwaway repo for AC-43 demos: `fixtureGit` (lines 364-380) isolates global config, hooks and identity. It sets `core.autocrlf=false`, so the LF proof needs a case that overrides it with `true`. Self-test reporting: the `ok(cond, what)` helper at lines 553-557. Git commands and the shallow-clone refusal: RESEARCH Pattern 8. Finding IDs: `.planning/audit/findings/*.json` and `decisions/OD-*.json`.

---

### Gate wrapper tests

**In-process, for scripts that export functions:** `test/unit/viMockGate.test.ts:32-41` (temp-file cases) and lines 58-62 (passes the real suite).
```typescript
function checkTemp(files: Record<string, string>): Violation[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-mock-gate-'));
    try {
        for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
        return checkViMockPaths([path.join(dir, 'case.ts')]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
```
**Child-process, for `--self-test` scripts:** `test/integration/backupState.test.ts:14-28`.
```typescript
const result = spawnRailedChild('npx', ['ts-node', 'scripts/backup-state.ts', '--self-check'], { timeoutMs: 110_000 });
const output = `${result.stdout}\n${result.stderr}`;

expect(result.status, output).toBe(0);
```
Git works in a railed child: `test/rails/core.cjs` does not hook `child_process`, and `PATH` is inherited (`spawnRailedChild.ts:344-346`). Git spawned this way has not been run yet, so confirm it in the first task. No existing test wraps the audit tools' self-tests.

Seeded broken fixtures for the mock-list check: `test/fixtures/viMockGate/` is the pattern, and `collectSourceFiles` (line 245) shows the exclusion. A fixture folder under `test/realpath/` would conflict with "no exceptions" (D-09), so keep seeded fixtures outside that folder or use temp files.

---

### `.planning/audit/tools/check.ts` (modify, D-21)

**The line to change** (320):
```typescript
if (rc.length && d.status === 'NOT-A-BUG') add('status', `NAC-10: research candidate ${rc.join(', ')} may not be closed as NOT-A-BUG in Phase 22`);
```
**New rule shape:** `add(field, message)` in the same per-finding function. **Self-test shape** for each new rule (lines 1283-1295):
```typescript
{
    const root = mutate('04', (r) => {
        edit(r, 'findings/AUD-SRC-004.json', (d) => (d.status = 'NOT-A-BUG'));
        ...
    });
    const res = runCheckIn(root, repo, 'partial');
    record('04 RC entry NOT-A-BUG / ...', hasFail(res, 'NAC-10: research candidate RC-04') && ..., ...);
}
```
Case 04 asserts today's ban, so it has to change together with line 320.

---

### `.planning/audit/tools/seal-verify.ts` (modify, D-19) and the successor seal

**The flaw** (lines 512-516): the `--diff-merges=first-parent` log at line 515 counts a merge's whole diff.
```typescript
const range = `${sealed}..HEAD`;
const changed = new Set<string>([
    ...splitNul(gitText(repo, ['diff', '--no-renames', '--name-only', '-z', range])),
    ...splitNul(gitText(repo, ['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-merges=first-parent', range])),
]);
```
**New self-test:** add a merge-commit case in the fixture block at lines 569-609, using `reset()` (line 609), `put`, `commit` and `g`.

**Successor record shape:** `baseSeal()` at lines 596-605 lists the fields `verifySeal` expects (`sealed_sha`, `phase_start_sha`, `scan`, `final_check`, `render_sha256`, `exempt_paths`, `rule`). `SEAL_REL` is the single seal path today (line 482), so the successor needs its own path argument or constant. `SEAL.json` stays byte-unchanged.

---

### `test/realpath/recordings/.gitattributes`

**Analog:** `.planning/audit/.gitattributes`. Copy the rule and restate the reason:
```
* text=auto eol=lf
```

---

### 11 source-text conversions (AC-37, Claude's discretion)

Files: `test/integration/anti-rug/botWiring.test.ts`, `test/integration/pauseCli.test.ts`, `test/integration/preflightCli.test.ts`, `test/integration/processLock.test.ts`, `test/unit/api/antiRug.test.ts`, `test/unit/bot/twoStageSigint.test.ts`, `test/unit/chainRegistry/antiRugConfig.test.ts`, `test/unit/exitEngine/antiRugReason.test.ts`, `test/unit/mainEntry.test.ts`, `test/unit/mevStrategies/inclusionReconciliation.test.ts`, `test/unit/rails/dotenvSrcSkip.test.ts` (case e only).

**Before-shape to remove** (`test/unit/bot/twoStageSigint.test.ts:133-139`):
```typescript
const src = readFileSync(resolve(__dirname, '../../../src/bot.ts'), 'utf8');
expect(src).not.toContain('function gracefulShutdown');
expect(src).toContain('createTwoStageShutdown');
```
**After-shape:** that file already imports the real `createTwoStageShutdown` (line 34) and spies on exit (line 38), so behavior tests beside the text check are the model. Where the behavior is process-level, use the child-fixture pattern from `directEntryGuard.test.ts`. A removal must name its reason (AC-38).

## Shared Patterns

### Rails (every new test)
**Source:** `vitest.config.ts:20-23`. **Apply to:** the `realpath` project. Any child process goes through `test/rails/spawnRailedChild.ts`, with no exceptions (Phase 22 D-03).

### Gate script contract
**Source:** `scripts/check-vi-mock-paths.ts:28-31,39-44,291`. **Apply to:** all three new `scripts/` gates. ABI guard first, exit 0, 1 or 2, a `require.main` guard, and a run that checked nothing is an error rather than a pass. Add a `--self-test` flag on the model of `seal-verify.ts:552`.

### Fail closed on a silent no-op
**Source:** `check-vi-mock-paths.ts:278`, RESEARCH Pattern 1 and Pattern 3. **Apply to:** seams, unknown RPC methods and URLs (fail in `afterEach`), census `unknown`, and shallow clones.

### Mock factories under `mockReset: true`
**Source:** RESEARCH anti-patterns. **Apply to:** the allowed logger, notifier and Telegram mocks. Use plain functions in `vi.mock` factories. The harness logger mock also feeds the timeline, so it must be one shared module.

### Test file header
**Source:** `test/integration/backupState.test.ts:1-6`, `directEntryGuard.test.ts:1-5`. **Apply to:** all new tests. Path, then plan and requirement, then why the test takes this form.

### Env values
**Source:** `spawnRailedChild.ts:121-123` (`readSentinels`). **Apply to:** env baseline and fixtures. Sentinels only, and the secret scan covers the snapshots (AC-51).

## No Analog Found

The planner should use the named RESEARCH.md prototype.

| File | Role | Data Flow | Use Instead |
|---|---|---|---|
| `test/realpath/harness/fakeNode.ts` | test utility | request-response | Pattern 3 method table; E3/E8 |
| `test/realpath/harness/fakeWebSocket.ts` | test utility | event-driven | E1d; `.websocket.on/ping/terminate` are used directly by `src/` |
| `test/realpath/harness/routers.ts` | test utility | request-response | Pattern 3 relay rows; Pitfall 10 |
| `test/realpath/harness/dbCapture.ts` | test utility | event-driven | Pattern 5; TEMP triggers; capture `db.inTransaction` (Open Question 5). `safeIntegers` with trigger arguments is unrun (A3) |
| `test/realpath/harness/serializer.ts` | test utility | transform, file-I/O | Pattern 6; Pitfall 4 |
| `test/realpath/harness/knownBug.ts` | test utility | transform | Pattern 4; E10 |

## Metadata

**Analog search scope:** `test/` (unit, integration, rails, helpers, fixtures), `scripts/`, `.planning/audit/tools/`, `src/utils/`, `src/guards/`, `.github/workflows/`, root config.
**Files scanned:** 24 opened or searched for excerpts, from 205 tracked test files listed.
**Project skills:** none (`.claude/skills` and `.agents/skills` do not exist; no project `CLAUDE.md`).
**Pattern extraction date:** 2026-11-09
