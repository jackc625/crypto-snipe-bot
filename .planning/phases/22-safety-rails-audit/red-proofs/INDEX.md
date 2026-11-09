# RED Proofs Index (AC-18)

Each row is one rail or guard, the file that records it going RED, what was switched off, and the test or gate that failed. Every neutralisation was made in the working tree only, was restored byte-exact, and was never committed. Each proof file holds its own diff, command, failing excerpt and GREEN rerun.

| # | Rail or guard | RED proof file | What was switched off | Test or gate that went RED |
|---|---|---|---|---|
| 1 | Dummy env: every app key comes from the test sentinels | `22-08-1-sentinel-env.txt` | `test/rails/core.cjs`: sentinel values not assigned | `test/unit/rails/envSentinel.test.ts` |
| 2 | Read of the repo `.env` is blocked and recorded | `22-08-2-env-block.txt` | `test/rails/core.cjs`: the `.env` branch of the file-read check | `test/unit/rails/envSentinel.test.ts` (env block) |
| 3 | DB tripwire, setup layer (native addon constructor) | `22-08-3-db-tripwire-setup.txt` | `test/rails/core.cjs`: addon constructor checks | `test/unit/rails/dbTripwireSetup.test.ts` |
| 4 | Non-loopback TCP deny | `22-08-4-net-deny-tcp.txt` | `test/rails/core.cjs`: the connect wrapper passes through | `test/unit/rails/netDeny.test.ts` (192.0.2.1) |
| 5 | Railed children receive the rails preload | `22-08-5-child-preload.txt` | `test/rails/spawnRailedChild.ts`: `--require` omitted | `test/unit/rails/childRails.test.ts` |
| 6 | Fork mode keeps exactly the two shell keys | `22-08-6-fork-shell-keys.txt` | `test/rails/core.cjs`: fork re-apply is a no-op | `test/unit/rails/childRails.test.ts` (fork shell) |
| 7 | File-system block on `data/` | `22-08-7-data-fs-block.txt` | `test/rails/core.cjs`: the `data/` branch of the file check | `test/unit/rails/dbTripwireSetup.test.ts` |
| 8 | `spawnRailedChild` limits | `22-08-8-spawn-guard.txt` | `test/rails/spawnRailedChild.ts`: `checkSpawnLimits` returns early | `test/unit/rails/childRails.test.ts` (spawn limits) |
| 9 | UDP deny | `22-08-9-udp-deny.txt` | `test/rails/core.cjs`: dgram send and connect pass through | `test/unit/rails/netDeny.test.ts` (udp) |
| 10 | DB tripwire, `src` layer | `22-09-1-db-tripwire-src.txt` | `src/utils/db.ts`: the Vitest tripwire | `test/unit/rails/dbTripwireSrc.test.ts` |
| 11 | Newer-schema version probe | `22-09-2-version-probe.txt` | `src/utils/dbPath.ts`: the version check | `test/integration/dbGuards.test.ts` |
| 12 | Refuse to create a missing DB outside Vitest | `22-09-3-refuse-to-create.txt` | `src/utils/dbPath.ts`: the refusal branches | `test/integration/dbGuards.test.ts` |
| 13 | DB write boundary | `22-09-4-write-boundary.txt` | `src/utils/dbPath.ts`: the write boundary | `test/integration/dbGuards.test.ts` |
| 14 | Notifier refuses a Telegram send | `22-10-1-notifier-telegram.txt` | `src/utils/notifier.ts`: `refuseUnderVitest()` in `sendTelegramAlert` | `test/unit/rails/notifierRefusal.test.ts` |
| 15 | Notifier refuses a context alert | `22-10-2-notifier-ctx.txt` | `src/utils/notifier.ts`: `refuseUnderVitest()` in `sendCtxAlert` | `test/unit/rails/notifierRefusal.test.ts` |
| 16 | No dotenv load in `src/config.ts` under Vitest | `22-10-3-dotenv-config.txt` | `src/config.ts`: the Vitest gate on the dotenv site | `test/unit/rails/dotenvSrcSkip.test.ts` |
| 17 | No dotenv load in `scripts/pause.ts` under Vitest | `22-10-4-dotenv-pause.txt` | `scripts/pause.ts`: the Vitest gate on the dotenv site | `test/unit/rails/dotenvSrcSkip.test.ts` |
| 18 | Spawn gate: `spawnRailedChild` is the only spawner | `22-11-1-spawn-gate.txt` | A temporary `spawnSync` added to `test/integration/pauseCli.test.ts` | `test/unit/rails/spawnSites.test.ts` |
| 19 | Fork RPC URL has no fallback | `22-11-2-fork-rpc-source.txt` | `test/fork/helpers/forkRpcUrl.ts`: old fallback restored | `test/unit/rails/forkRpcSource.test.ts` |
| 20 | Hardhat child gets the sanitized env | `22-11-3-hardhat-child-env.txt` | `test/fork/helpers/hardhatChildEnv.ts`: starts from the parent env, no preload | `test/unit/rails/hardhatChildEnv.test.ts` |
| 21 | Fork workers read only shell-sourced values | `22-11-4-fork-inworker-rpc.txt` | `test/fork/exitStatePersistence.fork.test.ts`: old fallback restored | `test/unit/rails/forkShellOnly.test.ts` |
| 22 | Duplicate-load guard on the singletons | `22-12-1-singleton-guard.txt` | `src/guards/singleton.ts`: `registerSingleton` returns at once | `test/unit/guards/singleton.test.ts` |
| 23 | Epoch rule allows a full module-graph reset | `22-12-2-singleton-epoch.txt` | `src/guards/singleton.ts`: every existing entry refused | `test/unit/guards/singleton.test.ts` |
| 24 | Process lock handle is pinned against garbage collection | `22-13-1-lock-pin.txt` | `src/utils/processLock.ts`: the `globalThis` pin | `test/integration/processLock.test.ts` |
| 25 | A held process lock refuses a second bot | `22-13-2-lock-refusal.txt` | `src/utils/processLock.ts`: `SQLITE_BUSY` swallowed | `test/integration/processLock.test.ts` |
| 26 | Direct start of `src/bot.ts` is refused before any import | `22-13-3-direct-entry-first-import.txt` | `src/bot.ts`: guard moved below the `./config` import | `test/unit/mainEntry.test.ts` |
| 27 | `vi.mock` gate fails on broken specifiers | `22-14-1-vi-mock-gate-fixtures.txt` | Nothing switched off: the gate runs on its seeded broken fixtures | `scripts/check-vi-mock-paths.ts` (exits 1, names all four violations) |
| 28 | The `vi.mock` gate's own test | `22-14-2-vi-mock-gate-mutation.txt` | `scripts/check-vi-mock-paths.ts`: checker disabled | `test/unit/viMockGate.test.ts` |

## Other files in this folder

| File | What it is |
|---|---|
| `22-10-tdd-red-evidence.json` | The 22-10 TDD red-phase evidence for the notifier and dotenv work. It is supporting evidence and is not one of the 28 named proofs. |
