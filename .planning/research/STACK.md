# Stack Research: v7.0 Full Audit & Modernization

**Domain:** Dependency and tooling modernization of a live-proven TypeScript MEV sniper bot. The bot uses Node, ethers v6, better-sqlite3, Express 5, a React/Vite dashboard, and Hardhat for one deployed contract.
**Researched:** 2026-11-06
**Confidence:** HIGH overall. Most version, compatibility, and vulnerability claims were checked against the npm registry, the published tarballs, and actual install and run tests on this Windows 11 / Node 24.18 / npm 11.16 machine. Claims that rest only on docs or web sources are tagged.

> **Evidence key:**
> - **[EXEC]** I reproduced it locally: installed and ran it, or read the published package code.
> - **[REG]** Comes from npm registry metadata (`npm view`).
> - **[DOC]** Comes from official docs or release notes (seam tier MEDIUM).
> - **[WEB]** Comes from secondary sources (seam tier LOW, or MEDIUM when cross-verified).
>
> Scratch reproductions are in `%TEMP%/claude/.../scratchpad/{target1,tsl,bs3i,hh,ign,hhi}`.

---

## TL;DR: The Decisions

| # | Question | Decision | Blocker / evidence |
|---|----------|----------|--------------------|
| 1 | TypeScript 7 | **Adopt TS 7.0.2 for `tsc` (typecheck gate and dashboard `tsc -b`). Keep TS 6.0.x as the `typescript` package for the API consumers (typescript-eslint, type-coverage, @vitest/eslint-plugin).** Use Microsoft's official npm-alias layout. | **BLOCKED for typescript-eslint.** Its peer is `typescript >=4.8.4 <6.1.0` [REG], and TS 7's main export (`lib/version.cjs`) only exposes `version` [REG/EXEC]. The upstream issue [#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) was closed as "blocked by #10940". The TS 7.1 API is expected next; 7.1.0-beta shipped 2026-10-20 [REG]. |
| 2 | Hardhat 3 | **Migrate to Hardhat 3.21.2 with only hardhat-ignition, hardhat-verify, and hardhat-keystore. No toolbox, no typechain, no chai, no gas-reporter, no solidity-coverage.** Pin `evmVersion: "paris"` and `optimizer: { enabled: false }` in **both** the default and production build profiles. | Hardhat 3 hard-requires `"type": "module"` [EXEC: `cli/main.js` prints "Hardhat only supports ESM projects"]. HH3 also changes the 0.8.28 default EVM target to `cancun`, and Ignition deploys with a `production` profile that turns the optimizer on [EXEC]. |
| 3 | ESM | **Move the whole repo to `"type": "module"`, with `module: "nodenext"` and relative imports written as `.ts`.** | Hardhat 3 forces it. Every runtime dependency imports cleanly from ESM [EXEC]. The one fix needed is gramjs subpath imports (`ERR_UNSUPPORTED_DIR_IMPORT`) [EXEC]. |
| 4 | ts-node replacement | **Production bot and all scripts: Node's built-in type stripping, i.e. `node src/bot.ts` with no runner. tsx 4.23 is only a fallback.** | Type stripping is Stable since v24.12.0 [DOC]. The codebase has no enums, no namespaces, and parameter properties only in 2 test files [EXEC grep]. |
| 5 | Formatter | **Prettier 3.9.10 with prettier-plugin-tailwindcss 0.8.1** | Biome would need its own config vocabulary and offers no Tailwind class-sorting parity. Prettier is native in WebStorm. |
| 6 | Quality tooling | **knip 6.44, dependency-cruiser 18.7, type-coverage 2.31, @vitest/eslint-plugin 1.6, lefthook 2.2, Dependabot (grouped, with cooldown), `npm audit --omit=dev` plus `npm audit signatures`, Vitest per-glob coverage floors.** | Do **not** add husky/lint-staged, Renovate, eslint-plugin-boundaries, osv-scanner, or dependency-review-action. Commits go straight to master, so there are no PRs to review. |
| 7 | Prod vulns | **All 11 clear with minor/patch bumps, a fresh lockfile, and dropping `uuid`.** | The proposed manifest resolves to **`npm audit --omit=dev` → 0 vulnerabilities** [EXEC]. |
| 8 | better-sqlite3 13 | **Upgrade to 13.0.3 and add `"allowScripts": { "better-sqlite3": false }`.** | **`npm ci` fails on this Windows machine** without that entry: npm runs `node-gyp rebuild` despite `gypfile:false`. With the entry, `npm ci` passes and the bundled prebuild loads (SQLite 3.53.4) [EXEC]. |
| 9 | CI | **checkout v7.0.1, setup-node v7.1.0, setup-python v7.1.0, dorny/paths-filter v4.0.3, all pinned by SHA. Node 26 LTS primary, Node 24 floor in the matrix. Plain `npm ci`.** | `--legacy-peer-deps` is caused by exactly one package: `@flashbots/ethers-provider-bundle` pins its peer to `ethers: "6.7.1"` [EXEC ERESOLVE]. An `overrides` entry fixes it [EXEC]. |

---

## Recommended Stack

### Core runtime and language

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | **26.x LTS "Lithium"** for production and CI primary. `engines: ">=24.12.0"` floor, with 24 in the CI matrix. | Runtime | Node 26 entered Active LTS on 2026-10-28 (EOL 2029-04-30). Node 24 went into maintenance on 2026-10-20 [DOC: nodejs/Release schedule.json]. The milestone already ends with a live re-proof, so switching runtime now gets validated for free; staying on 24 would force a second runtime migration and a second live re-proof later. The 24.12 floor is where type stripping became Stable. Vitest 5 (`^22.12 \|\| ^24 \|\| >=26`), Hardhat 3 (>=22.13), better-sqlite3 13 (>=22, N-API), and dependency-cruiser (`^22\|\|^24\|\|>=26`) all support both [REG]. **Switch the local machine (currently 24.18) to 26 only after the full unit, integration, and fork suites pass on 26 in CI.** |
| npm | **11.16+**. Pin it with `"packageManager": "npm@11.16.0"` and/or `devEngines`. | Package manager | `allowScripts` support arrived in 11.16, and the better-sqlite3 fix depends on it. The npm v12 default reportedly skips unapproved install scripts [WEB], so declaring `allowScripts` now future-proofs installs. |
| TypeScript (compiler) | **7.0.2** installed as `"@typescript/native": "npm:typescript@^7.0.2"`. It provides `tsc`. | Typecheck gate (root and dashboard), optional emit | Stable since 2026-07-08 and 8-12x faster [DOC]. Code that is clean on 6.0 compiles identically on 7.0 [DOC]. **[EXEC]** `tsc` 7.0.2 compiled a `nodenext` project with `.ts` imports, `erasableSyntaxOnly`, and `rewriteRelativeImportExtensions`, and the output ran. |
| TypeScript (API package) | **6.0.x** installed as `"typescript": "npm:@typescript/typescript6@^6.0.2"`. It provides `tsc6` and resolves to 6.0.3. | Programmatic API for typescript-eslint, type-coverage, @vitest/eslint-plugin, dependency-cruiser | This is Microsoft's official side-by-side layout from the TS 7.0 announcement [DOC]. **[EXEC]** typescript-eslint 8.72.1 with ESLint 10.14 and `projectService` ran type-aware rules (`no-floating-promises` fired) against this alias, and `npm install` produced no ERESOLVE. Collapse to a single TS 7 once typescript-eslint ships TS 7 support (tracking issue #10940, which waits on the TS 7.1 API). |
| ethers | **6.17.0** | Chain client | Patch-level upgrade. It clears the moderate `ethers` advisory and the nested `ws` high, because ethers 6.17.0 pins `ws` to exact 8.21.0 [REG]. Dual CJS/ESM [REG]. |
| better-sqlite3 | **13.0.3** with `@types/better-sqlite3 ^9.6.0` | SQLite (WAL) | First release on N-API (node-addon-api). `prebuild-install` was removed and the prebuilds now ship inside the tarball (win32-x64, linux-x64, and others) [DOC/EXEC]. Because N-API is ABI-stable, there is no rebuild when moving between Node 24 and 26. SQLite is 3.53.4 [EXEC]. See the migration notes for the `npm ci` trap. |
| express | **5.3.0** | API and dashboard server | Requires `proxy-addr ^2.0.8` (fixes the critical), `body-parser ^2.3.0`, and `qs ^6.16.0` [REG]. |
| axios | **1.21.0** | HTTP (safety providers, bloXroute, notifier, CLIs) | Clears 32 advisories, all fixed by <1.20 [EXEC audit]. Brings `form-data ^4.0.6` and `follow-redirects ^1.16.0`. |
| ws | **8.22.1** | WebSocket server/client | Clears GHSA-58qx and GHSA-96hv. |
| pino / pino-pretty | **10.4.0 / 13.2.0** | Logging | Minor bumps. CJS, but the default import works from ESM [EXEC]. No transport is configured in `src/utils/logger.ts`, so pino-pretty correctly stays dev-only. |
| helmet / cors / cookie-parser | **8.3.0 / 2.8.6 / 1.4.7** | HTTP middleware | Current. ESM default imports work [EXEC]. |
| dotenv | **18.0.9** | `.env` loading | Breaking changes in 18: the inject message goes to **stderr**, tips are removed, preloading (`node -r dotenv/config`) is removed, and `.env.vault` is removed [DOC changelog]. This repo calls `dotenv.config()` and `import 'dotenv/config'`, and the `./config` export still exists [REG], so neither is affected. Pass `{ quiet: true }` so the stderr line does not pollute pino JSON output. |
| telegram (gramjs) | **2.26.22** (latest; last real publish 2025-02) [REG] | Alpha-listener MTProto client | Stale but no replacement is needed. Its vulnerable transitive (`socks` → `ip-address`) is fixed by a fresh lockfile. **ESM fix required:** `telegram/sessions` and `telegram/events` fail with `ERR_UNSUPPORTED_DIR_IMPORT` because the package has no `exports` map [EXEC]. Use `import { TelegramClient, sessions } from 'telegram'` plus `import { NewMessage } from 'telegram/events/index.js'`. Both verified [EXEC]. |
| @flashbots/ethers-provider-bundle | **1.0.0 (keep for now, with `overrides`)**. Replacement planned as an explicit operator decision. | Flashbots signBundle / simulate / sendBundle / wait | Unmaintained: last publish 2024-02 [REG]. It pins its peer to `ethers: "6.7.1"`, which is the **sole** cause of `--legacy-peer-deps` [EXEC]. It silently drops `builders` (the repo already hand-rolls raw `eth_sendBundle`). `getBundleStatsV2`, called at `flashbots.ts:345`, has **returned 403 since 2025-06-09** [WEB, cross-verified with flashbots-docs PR #638]. See the "What NOT to Use" section and the migration notes. |

### Contracts toolchain (dev only)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| hardhat | **3.21.2** | Compile, `hardhat node --fork` for the fork suite, deploy host | Required for HONEY-04 on the cleaned codebase. Its dependency tree is far smaller than the HH2 toolbox: the proposed manifest has 626 lockfile packages versus 908 today [EXEC]. |
| @nomicfoundation/hardhat-ignition | **3.1.9** (pulls ignition-core ^3.1.8) | `hardhat ignition deploy` | The deploy wrapper `scripts/deploy-honeypot-checker.ts` shells out to this task. The `@nomicfoundation/hardhat-ignition/modules` export path is unchanged [REG]. |
| @nomicfoundation/hardhat-verify | **3.1.4** | `hardhat verify` / `ignition deploy --verify` | Peer of hardhat-ignition [REG]. Config moves from `etherscan.apiKey` to `verify.etherscan.apiKey` [DOC]. |
| @nomicfoundation/hardhat-keystore | **3.1.2** | Encrypted-at-rest `DEPLOY_PRIVATE_KEY` | `configVariable("DEPLOY_PRIVATE_KEY")` resolves from the env var first and the encrypted keystore second [DOC]. This lets the D-DEPLOY-KEY capability split stop relying on plaintext `.env` for the deploy key, which matches the high-stakes-ops convention. Optional but recommended before HONEY-04. |
| @openzeppelin/contracts | **5.4.0 exact pin (do NOT bump to 5.6.1 in v7.0)** | `IERC20` / `SafeERC20` imports in HoneypotChecker; ERC20 in fixtures | The deployed ETH checker's build-info used OZ 5.4.0, solc 0.8.28, `paris`, optimizer off [EXEC: `ignition/deployments/chain-1/build-info`]. Contract source is out of scope for v7.0. Bumping OZ changes what the fork suite tests compared to what is deployed. Bump it inside HONEY-04 alongside the contractual re-audit. **Operator decision:** this is the one deliberate exception to "everything to latest". |

### Dev tooling

| Tool | Version | Purpose | Notes |
|------|---------|---------|-------|
| vitest / @vitest/coverage-v8 | **5.1.0 / 5.1.0** | Unit, integration, and fork suites | Peer `vite ^6.4\|\|^7\|\|^8`. npm auto-installs it, but list `vite ^8.3.6` explicitly in the root devDeps for determinism. **[EXEC]** Vitest 5 runs `.ts`-extension imports and `vi.mock` under `"type":"module"`, and it **still shims `require` and `__dirname` inside test files** (see pitfall P-4). |
| eslint / @eslint/js | **10.14.0 / 10.0.1** | Lint | Flat config only. Config lookup now starts from each linted file's directory, so dashboard files resolve to the root config (correct here). New `eslint:recommended` rules: `no-unassigned-vars`, `no-useless-assignment`, `preserve-caught-error` [DOC]. |
| typescript-eslint | **8.72.1** | Type-aware lint (`projectService`) | Runs against the TS 6 alias. Use `defineConfig` from `eslint/config` instead of `tseslint.config()`. |
| @vitest/eslint-plugin | **1.6.28** | `no-focused-tests`, `valid-expect`, `expect-expect`, `no-disabled-tests` | Peer `typescript >=6.0.0` is satisfied by the alias [REG]. |
| eslint-plugin-react-hooks / eslint-plugin-react-refresh / globals | **7.1.1 / 0.5.7 / 17.14.0** | Dashboard lint (currently unlinted) | Both peers accept ESLint 10 [REG]. |
| prettier / prettier-plugin-tailwindcss | **3.9.10 / 0.8.1** | Formatting | `eslint-config-prettier` is **not** needed: `recommendedTypeChecked`/`strictTypeChecked` contain no stylistic rules. Prettier 4 is still `4.0.0-alpha.13` [REG], so do not adopt it. |
| tsx | **4.23.15** (already a transitive dependency of hardhat 3) | Fallback runner only | Use only if a script ever needs non-erasable syntax. Do not use it for the bot. |
| knip | **6.44.1** | Unused files, exports, and dependencies | Uses oxc-parser and does **not** depend on the TS API, so it is TS-7-safe [REG]. **[EXEC]** It flagged unused devDeps correctly in a sample. It will immediately flag `scripts/addLiquidity.ts` and `scripts/deploySepoliaTest.ts`, which import artifacts (`UniswapV2Router02.sol`, `IWETH.sol`) that no longer exist in `contracts/`. |
| dependency-cruiser | **18.7.2** | Domain-boundary rules, cycle detection, orphans | Encodes the restructure's `detection/safety/execution/exit/anti-rug/api` layering and `no-circular`. Uses the `typescript` package (TS 6 alias) to parse. |
| type-coverage | **2.31.2** | `--strict --at-least N` ratchet on `any` | Its peer says `typescript 2..7`, but it needs the TS API at runtime, so it only works via the TS 6 alias. It complements `no-unsafe-*` by catching implicit `any` from untyped JSON and casts. |
| lefthook | **2.2.2** | Pre-commit: prettier on staged files, eslint on staged files, `tsc --noEmit` | A single Go binary that runs jobs in parallel, has built-in staged-file globbing and `stage_fixed`, and works on Windows. It replaces both husky and lint-staged. |
| Dependabot | (GitHub-native) | npm (root and `/dashboard`) and github-actions updates | Weekly, grouped (prod-minor, dev-minor, majors separate), with a `cooldown` such as `default-days: 7` and `semver-major-days: 14` as a supply-chain delay [DOC: dependabot options reference]. |

---

## Compatibility Matrix (verified)

| Component | TS 7.0.2 (`tsc`) | TS 6.0.3 (API alias) | ESM `"type":"module"` | Node 24.18 | Node 26 | Evidence |
|-----------|------------------|----------------------|----------------------|-----------|---------|----------|
| `tsc --noEmit` / emit | YES | YES (`tsc6`) | YES (`nodenext`) | YES | YES | [EXEC] |
| typescript-eslint 8.72.1 `projectService` | **NO.** Peer `<6.1.0`, and the 7.0 API is not exposed (crashes with "reading 'Cjs'"). | YES | YES | YES | YES | [REG][EXEC][DOC #12518] |
| ESLint 10.14 | n/a | YES | YES (`eslint.config.mjs`) | YES | YES | [EXEC] |
| Vitest 5.1 (oxc/esbuild transform) | n/a, does not use TS | n/a | YES | YES | YES | [EXEC][REG engines] |
| tsx 4.23 (esbuild) | n/a | n/a | YES | YES | YES | [EXEC] |
| Node type stripping | n/a | n/a | YES | **Stable** (≥24.12) | Stable; `--experimental-transform-types` **removed** | [EXEC][DOC] |
| Hardhat 3.21 (loads config via tsx) | n/a | n/a | **Required** | YES (≥22.13) | YES | [EXEC][DOC] |
| hardhat-typechain 3.x | uses typechain 8 | | | | | Not needed: `typechain-types/` is imported nowhere [EXEC grep] |
| knip 6.44 (oxc) | safe | safe | YES | YES | YES | [REG][EXEC] |
| type-coverage 2.31 | **NO at runtime** | YES | YES | YES | YES | [REG] |
| dependency-cruiser 18.7 | **NO** (parses via `typescript`) | YES | YES | YES | YES | [REG] |
| @vitest/eslint-plugin 1.6 | | YES (peer `>=6`) | YES | | | [REG] |
| Dashboard: Vite 8.3.6 + plugin-react 6.2.1 (Rolldown/Oxc) | `tsc -b` on 7 = YES | not needed | already ESM | YES | YES | [REG] |
| better-sqlite3 13 (N-API) | n/a | n/a | default import YES | prebuild YES | prebuild YES (N-API) | [EXEC] |
| gramjs `telegram` 2.26.22 | n/a | n/a | root import YES; **directory subpaths NO** | YES | unverified | [EXEC] |
| @flashbots/ethers-provider-bundle 1.0.0 | n/a | n/a | named import YES (CJS), but it loads the **CJS copy of ethers** (dual-package hazard) | YES | unverified | [EXEC] |
| WebStorm language service | Point it at `node_modules/typescript` (TS 6) so the editor matches ESLint | | | | | [WEB, LOW]. A WebStorm build with TS 7 LSP support was not verified. |

**TS 7 verdict:** TS 7 is production-ready as a **type checker and emitter**, and that is all this repo needs from `tsc`. It is not usable as a **library** until 7.1. The fallback is the official dual install, not "stay on TS 6". When typescript-eslint support lands, drop the alias and set `"typescript": "^7.x"`.

---

## Migration Notes (checked against how THIS repo uses each package)

### TypeScript 5.8 → 6.0 bridge → 7.0

- **Errors in this repo's tsconfigs that TS 7 rejects** [DOC TS 7.0 announcement]: `moduleResolution: "node"` (node10) in `tsconfig.json` and `tsconfig.bot.json`. TS 7 also defaults `types` to `[]`. `types: ["node","hardhat","chai"]` must become `["node"]`: Hardhat 3 has no global types entry point, and chai is unused.
- **Consolidate the three tsconfigs into two.** Use a root `tsconfig.json` covering `src`, `scripts`, `test`, `hardhat.config.ts`, and `ignition`, plus `dashboard/tsconfig.json`. **Today `test/` and `scripts/` are never type-checked.** Vitest strips types without checking them, so the 131 test files currently have no type gate.
- Target root compiler options:
  ```jsonc
  {
    "compilerOptions": {
      "target": "es2024", "lib": ["es2024"],
      "module": "nodenext", "moduleResolution": "nodenext",
      "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
      "verbatimModuleSyntax": true,      // forces `import type` (required by Node type stripping)
      "erasableSyntaxOnly": true,        // forbids enum/namespace/param-properties (Node can't strip them)
      "allowImportingTsExtensions": true,
      "rewriteRelativeImportExtensions": true, // only matters if you ever emit
      "noEmit": true,
      "resolveJsonModule": true, "skipLibCheck": true,
      "types": ["node"]
    },
    "include": ["src", "scripts", "test", "ignition", "hardhat.config.ts", "vitest.config.ts"]
  }
  ```
- `erasableSyntaxOnly` hits exactly two places: the parameter properties `constructor(public url: string)` and `constructor(public key, public provider?)` in `test/integration/wsReconnect.test.ts:48,64` [EXEC grep]. There are no enums and no runtime namespaces anywhere.
- `noUncheckedIndexedAccess` will create churn but is the right call for money code: array and record index reads become `T | undefined`. Gate it as a separate commit inside the lint-zero phase.

### ESM conversion (prerequisite for Hardhat 3)

These are the concrete sites in this codebase [EXEC grep]:

| Pattern | Sites | Fix |
|---------|-------|-----|
| 333 relative imports without extensions | `src`, `scripts`, `test` | Codemod to `./x.ts`. Node type stripping **requires** explicit extensions [DOC]. tsc enforces it under `nodenext`. |
| `__dirname` | `src/api/routes/health.ts:15`, 3 scripts, ~15 fork tests | `import.meta.dirname` (verified present on 24.18 [EXEC]). |
| `require.main === module` | `src/bot.ts:2359` | `if (import.meta.main)` (verified `true` on 24.18 [EXEC]). This guard is what stops imports of `bot.ts` from booting the bot. Characterize it before changing it. |
| Inline `require('./utils/db')` in shutdown | `src/bot.ts:2344` | Static import, or `await import()`. Check for import cycles, since the lazy require probably exists to dodge one. |
| `require('http')`, `require('express')` in tests | 12 sites | Top-level `import`. They will keep "working" under Vitest regardless (pitfall P-4). |
| JSON imports | `scripts/addLiquidity.ts`, `scripts/deploySepoliaTest.ts` (both dead) | Delete the scripts. Any surviving JSON import needs `with { type: 'json' }`. |
| gramjs subpaths | `src/telegramListener.ts:6-7`, `scripts/telegram-login.ts:17` | `import { sessions } from 'telegram'` and `'telegram/events/index.js'`. |
| `import * as dotenv` | config, notifier, scripts | Works as-is under ESM [EXEC]. Optionally switch to `import 'dotenv/config'`. |
| `hardhat.config.ts` `__dirname` | config | Rewritten anyway for HH3. |

CJS packages under ESM: better-sqlite3, pino, express, cors, cookie-parser, gramjs, and flashbots all import correctly [EXEC smoke test]. ethers is dual-format.

### ts-node → Node type stripping

- Bot entry: `"start": "node --enable-source-maps src/bot.ts"`. The source-maps flag is harmless; type stripping keeps line and column numbers anyway [DOC]. This removes the `npx` process layer that swallows Ctrl+C on Windows (operator memory note), so the two-stage SIGINT handler receives signals directly. **Update `STATE.md` Operating Notes and the runbook.**
- Scripts: `"preflight": "node scripts/preflight.ts"`, and likewise for `pause` and `resume`. In CI, `npx ts-node scripts/check-mythril-report.ts` becomes `node scripts/check-mythril-report.ts`.
- **Why not compiled `dist/`:** a stale `dist/` is a real footgun for a solo operator who edits `src` and restarts. Type stripping runs exactly the checked source minus types. It has no build artifact, no transform-semantics drift (esbuild/tsx and tsc differ on things like class-field semantics), and no runtime dev dependency. The safety net is `tsc --noEmit` (TS 7) in CI and lefthook. Also delete `"main": "dist/index.js"` and the `"build": "tsc"` script, and add `"typecheck": "tsc --noEmit -p . && tsc --noEmit -p dashboard"`.
- **Why not tsx:** it would work, but it adds an esbuild transform and a dependency on the money path for no benefit. It stays available transitively for edge cases.

### Hardhat 2.26 → 3.21

Target `hardhat.config.ts`:
```ts
import "dotenv/config";
import { configVariable, defineConfig } from "hardhat/config";
import hardhatIgnition from "@nomicfoundation/hardhat-ignition";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";

// Byte-parity with the deployed ETH checker build-info (solc 0.8.28, paris, optimizer off).
const pinned = { version: "0.8.28", settings: { evmVersion: "paris", optimizer: { enabled: false, runs: 200 } } };

export default defineConfig({
  plugins: [hardhatIgnition, hardhatVerify, hardhatKeystore],
  solidity: { profiles: { default: pinned, production: pinned } },
  paths: { sources: { solidity: ["contracts", "test/fixtures/contracts"] } }, // replaces the HH2 subtask override
  networks: {
    sepolia:  { type: "http", chainType: "l1", url: configVariable("SEPOLIA_RPC_URL"), accounts: [configVariable("DEPLOY_PRIVATE_KEY")] },
    mainnet:  { type: "http", chainType: "l1", url: configVariable("ETH_RPC_URL"),     accounts: [configVariable("DEPLOY_PRIVATE_KEY")] },
    bsc:      { type: "http", chainType: "l1", url: configVariable("BSC_RPC_URL"),     accounts: [configVariable("DEPLOY_PRIVATE_KEY")] },
    base:     { type: "http", chainType: "op", url: configVariable("BASE_RPC_URL"),    accounts: [configVariable("DEPLOY_PRIVATE_KEY")] },
    arbitrum: { type: "http", chainType: "generic", url: configVariable("ARB_RPC_URL"), accounts: [configVariable("DEPLOY_PRIVATE_KEY")] },
  },
  verify: { etherscan: { apiKey: configVariable("ETHERSCAN_API_KEY") } },
});
```

- **The ESM requirement is absolute.** `printEsmErrorMessageIfNecessary` reads the closest `package.json` and refuses to run unless `type === "module"` [EXEC: hardhat 3.21.2 `dist/src/internal/cli/main.js`]. Hardhat docs say scripts and tests may stay CJS [DOC], but the config cannot. The only CJS-preserving alternative is a nested `contracts/package.json` workspace, which is rejected because the repo moves to ESM anyway.
- **Network `type: "http"`** is required on every network [DOC]. `configVariable` resolves lazily, so a missing env var fails only when that network is actually used. This preserves the "RPC plus key, both required" gate without the conditional-spread pattern. **Remove the `hardhat: { forking }` entry:** HH3 `hardhat node` uses the network named `node` [EXEC], and the fork suite passes `--fork` explicitly.
- **`subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS)` no longer exists.** `hardhat/builtin-tasks/task-names` is gone from the exports [REG], and subtask overrides were replaced by hooks [DOC]. Replace it with `paths.sources.solidity: [...]`, which accepts `string | string[]` [EXEC: `SourcePathsUserConfig`]. **This is mandatory:** HH3 treats every `.sol` under `test/` as a **Solidity test file** unless it also sits under a sources path, and sources take precedence [EXEC: `build-system.js getScope`]. Without it, `Honeypot.sol` and `RugPull.sol` stop being contracts.
- **Artifact paths are unchanged:** `artifacts/<userSourceName>/<Contract>.json` [EXEC: `build-system.js:513`]. So `artifacts/contracts/honeypot/HoneypotChecker.sol/HoneypotChecker.json` and `artifacts/test/fixtures/contracts/Honeypot.sol/Honeypot.json` still resolve for the fork tests, assuming unified (non-split) test compilation, which is the default.
- **Fork suite (`test/fork/setup.ts`) keeps working with small edits.** `npx hardhat compile --quiet` still works (`compile` aliases `build`, and `--quiet` exists). `npx hardhat node --fork <url> --port 8545` still works (`--fork` and `--forkBlockNumber` exist). Startup prints `Started HTTP and WebSocket JSON-RPC server at …`, so the `includes('Started HTTP')` match holds. The default chainId is still **31337**, so the EXIT-LIVE-08 real-mainnet gate is unchanged [EXEC]. The vitest `fork` project does depend on the Hardhat network, through this spawned node.
- **Solidity output drift (critical).** HH2 compiled 0.8.28 with `evmVersion: paris`, which is what the deployed checker used. HH3 defaults 0.8.28 to **`cancun`** [EXEC: `solc-info.js:104`]. On top of that, `ignition deploy` builds with the **`production`** profile [EXEC: `hardhat-ignition/dist/src/internal/tasks/deploy.js:91`], and that profile turns on `optimizer: { enabled: true, runs: 200 }` plus isolated builds [EXEC: `solidity/config.js:370`]. Without the `pinned` profiles above, the fork suite tests one bytecode and HONEY-04 deploys another.
- **Input source names change** to `project/contracts/...` [EXEC: `HARDHAT_PROJECT_INPUT_SOURCE_NAME_ROOT = "project"`]. That changes the CBOR metadata hash, so an HH3 recompile can never reproduce the deployed ETH checker byte-for-byte. Consequences:
  - The ETH checker is **already** Etherscan-verified, so do nothing.
  - Ignition reconciliation strips metadata before comparing [EXEC: `reconcile-artifacts.js` → `getBytecodeWithoutMetadata`], so the name change alone does not break `chain-1`.
  - However, the current checker **source already differs from the deployed one**, because of the pre-18-REVIEW-FIX bytecode. Re-running `ignition deploy` against `chain-1` with the unchanged module would fail with "Artifact bytecodes have been changed" regardless of Hardhat version. HONEY-04 must use a new deployment id (`--deployment-id`) or a new future id. Record this now.
- **Ignition 0.15 → 3.x journal compatibility:** every message type in `chain-1/journal.jsonl` (`DEPLOYMENT_INITIALIZE`, `TRANSACTION_PREPARE_SEND`, `ONCHAIN_INTERACTION`, `SUCCESS`, and the rest) exists in ignition-core 3.1.11's `JournalMessageType` [EXEC]. MEDIUM confidence that `hardhat ignition deployments` and `status chain-1` read it unchanged. **Verify on a copy first.**
- **`journal.jsonl` and the per-future `artifacts/` are not in git.** `ignition/.gitignore` ignores `deployments/*/journal.jsonl`, and the root `.gitignore` pattern `artifacts/` (no leading slash) also matches `ignition/deployments/chain-*/artifacts/` [EXEC: `git ls-files`]. The only copy of the ETH deployment state lives on this laptop. **Back up `ignition/deployments/` before touching Hardhat, and decide whether to track it** (recommended: track it; the data is public).
- **Drop, with no replacement needed:**
  - `@nomicfoundation/hardhat-toolbox`, `hardhat-ethers`, `hardhat-chai-matchers`, `hardhat-network-helpers`, `hardhat-ignition-ethers`: no script or test uses `hre.ethers`. The only Hardhat import outside config is the Ignition module.
  - `typechain`, `@typechain/*`: `typechain-types/` is imported nowhere.
  - `hardhat-gas-reporter` and `solidity-coverage`: peer `hardhat ^2` only [REG]. HH3 has built-in `test --coverage` and `--gas-stats`, but those only apply to Hardhat-run tests, and this repo has none.
  - `chai`, `@types/chai`, `@types/mocha`: chai is imported nowhere, and Vitest bundles its own expect.
  - `ignition-core`: arrives transitively via hardhat-ignition.
- **`test/unit/ethersV6ToolboxConfig.test.ts`** asserts toolbox v6, hardhat-ethers v3, and ethers `6.16.x`, so it will fail. Replace it with a test that asserts the HH3 invariants: `pinned` profiles, `paths.sources` includes the fixtures, and no `@nomiclabs` or toolbox packages.
- **chai 6 / chai-matchers:** not applicable, because both are removed. If Hardhat-native tests are ever added, `hardhat-toolbox-mocha-ethers` 4.0 requires `chai >=5.1.2 <7` [REG].

### Vitest 4.1 → 5.1 (affects this repo)

These come from the migration guide [DOC]:
- `clearMocks` now defaults to true. This is moot here because `mockReset: true` is already set.
- `extends` now defaults to true. It is already set explicitly in all three projects.
- `vi.mock` must be at top level, otherwise it throws. Grep found 0 indented calls [EXEC]. `vi.doMock`, which this repo uses heavily, is not hoisted and is unaffected.
- **Unawaited `resolves`/`rejects` now fail the test.** The 19 multi-line sites appear to be awaited, but Vitest 5 will flag any that are not. That is a correctness win.
- `coverage.include`/`exclude` are now matched relative to the root without "contains" semantics. `src/**/*.ts` is fine.
- Glob thresholds no longer inherit `perFile`.
- `describe.sequential` is removed (no usage).
- Money-path floors (paths finalized after the restructure):
  ```ts
  coverage: { provider: 'v8', include: ['src/**/*.ts'], thresholds: {
    lines: 70, branches: 70, functions: 70, statements: 70,
    'src/execution/**': { lines: 90, branches: 85, functions: 90, statements: 90 },
    'src/exit/**':      { lines: 90, branches: 85, functions: 90, statements: 90 },
    'src/anti-rug/**':  { lines: 85, branches: 80, functions: 85, statements: 85 },
    'src/**/nonce*.ts': { lines: 95, branches: 90, functions: 95, statements: 95 },
  } }
  ```
  Coverage is not a correctness proof. Per the project memory, the green suite has repeatedly masked money-path bugs, so floors complement real-path tests and never replace them.

### ESLint 9 → 10 config rewrite

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
export default defineConfig(
  globalIgnores(['**/dist/', 'artifacts/', 'cache/', 'coverage/', 'ignition/deployments/', '.planning/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/restrict-plus-operands': ['error', { allowNumberAndString: false, skipCompoundAssignments: false }], // D-07 kept
      '@typescript-eslint/switch-exhaustiveness-check': 'error', // HoneypotResult / DexConfig discriminated unions
      '@typescript-eslint/strict-boolean-expressions': ['error', { allowNullableBoolean: true }], // catches `if (amount)` with 0n
      '@typescript-eslint/no-unsafe-argument': 'error', // was 'warn'; zero-baseline goal
    } },
  { files: ['test/**'], ...vitest.configs.recommended },
  { files: ['dashboard/src/**/*.{ts,tsx}'], ...reactHooks.configs['recommended-latest'] },
);
```
`strictTypeChecked` is a deliberate step up from `recommendedTypeChecked`. Whether it lands at once or rule-by-rule toward zero is a phase-planning call, but it is the right target for capital-handling code.

### better-sqlite3 12.8 → 13.0.3

- **Breaking:** the move to N-API (node-addon-api) and the removal of `prebuild-install`; prebuilds now ship in the tarball [DOC releases]. 13.0.1 fixed an over-strict cross-realm parameter-binding regression, and 13.0.2 bumped SQLite to 3.53.4 and fixed a worker-thread abort. No PRAGMA, WAL, or `pragma({simple:true})` API changes are listed. This repo uses `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout`, `user_version` (currently 7), and `wal_checkpoint(FULL)`.
- **[EXEC] `npm ci` trap:** `npm install` works, but `npm ci` from the lockfile runs `node-gyp rebuild` (npm ignores `gypfile:false` on the lockfile path) and fails here with "missing any VC++ toolset". On ubuntu CI it would silently compile from source for nothing. **Fix (verified):**
  ```json
  "allowScripts": { "better-sqlite3": false, "es5-ext": false, "esbuild": true, "bufferutil": true, "utf-8-validate": true, "lefthook": true }
  ```
  `es5-ext` is the protestware postinstall, pulled in through gramjs → `websocket`. Deny it.
- Re-run the DB characterization tests for WAL, checkpoint, and the `user_version` migration chain on 13. DB I/O is not on the hot money path, but persistence of exit state and the kill-switch is.

### uuid → `crypto.randomUUID()`

`uuid` is used once (`src/api/middleware/auth.ts:7`, `v4`). uuid 14 is ESM-only, and `@types/uuid` 11 is a deprecated stub [REG]. Replace the call with the global `crypto.randomUUID()` (RFC 4122 v4, CSPRNG) [EXEC], then remove both packages. This also clears the moderate uuid advisory.

### Dashboard (separate `dashboard/package.json`, already ESM)

Bump to react/react-dom 19.3.1, @types/react(-dom) 19.3.0, react-router-dom 7.18.5, vite 8.3.6, @vitejs/plugin-react 6.2.1, tailwindcss and @tailwindcss/vite 4.3.5, chart.js 4.6.1, lightweight-charts 5.2.1, and react-chartjs-2 5.3.1. Use `typescript ^7.0.2` directly: the dashboard has no API-consuming tools, since root ESLint lints it with the root TS 6.

**lucide-react 0.510 → 1.70 is a major bump.** 1.0 removed brand icons and set `aria-hidden` by default [WEB]. The dashboard imports `AlertOctagon` and `PauseCircle`, which are legacy alias names. Switch to the canonical `OctagonAlert` and `CirclePause` and let `tsc -b` confirm.

---

## Production Vulnerability Remediation (all 11 → 0, verified)

| Package | Sev | Path today | Clearing action |
|---------|-----|-----------|-----------------|
| proxy-addr ≤2.0.7 (GHSA-jqcg-44mw-7w3h) | **critical** | express 5.2.1 | express `^5.3.0` (requires `proxy-addr ^2.0.8`) |
| body-parser <2.4.0 (GHSA-v422, GHSA-27r3) | high | express | Fresh lockfile → 2.4.0. **express 5.3's `^2.3.0` range still admits vulnerable 2.3.x, so the lock must be regenerated, not patched.** |
| qs ≤6.16.0 (4 advisories) | moderate | express / body-parser | Fresh lockfile → 6.17.1. express's `^6.16.0` admits vulnerable 6.16.0, same caveat. |
| axios <1.20 (32 advisories) | high | direct | axios `^1.21.0` |
| form-data <4.0.6 (GHSA-hmw2) | high | axios | axios 1.21 requires `^4.0.6` |
| follow-redirects ≤1.15.11 (GHSA-r4q5) | moderate | axios | axios 1.21 requires `^1.16.0` |
| ws <8.21.0 (GHSA-58qx, GHSA-96hv) | high | direct, plus the nested `ethers/node_modules/ws` | ws `^8.22.1`; ethers `6.17.0` pins ws 8.21.0 |
| ethers ≤6.16.0 (via ws) | moderate | direct | ethers `^6.17.0` |
| ip-address ≤10.7.3 (6 advisories) | high | telegram → socks 2.8.6 → ip-address 9.0.5 | Fresh lockfile → socks 2.8.10 → ip-address 10.7.6. gramjs's `socks ^2.6.2` allows it; no gramjs change needed. |
| socks 2.7.2–2.8.6 | moderate | via ip-address | Same as above |
| uuid 13.0.0 (GHSA-w5hq) | moderate | direct | Remove, using `crypto.randomUUID()` |

**[EXEC]** The proposed manifest (scratch `target1`) gives `npm audit --omit=dev` → **found 0 vulnerabilities**.

**Residual dev-tree advisories that cannot be fixed today:**
- `zod <4.6.6` (GHSA-mrhx-c7xc-m3w5, high), reached via hardhat, hardhat-verify, hardhat-keystore, and hardhat-zod-utils. Hardhat 3 depends on `zod ^3.23.8`, and no 3.x fix exists.
- `minimatch` (GHSA-g3hv, moderate), reached via eslint and typescript-eslint.

Both are build-time only and never in the bot process. **That is why the CI gate is `--omit=dev`.** Track both rather than override them, since forcing zod 4 into Hardhat would break it.

---

## Installation (target)

```bash
# 0. BACK UP ignition/deployments/ first (journal + artifacts are gitignored; only copy is local)

# Runtime deps
npm install ethers@^6.17.0 axios@^1.21.0 better-sqlite3@^13.0.3 express@^5.3.0 ws@^8.22.1 \
  dotenv@^18.0.9 pino@^10.4.0 helmet@^8.3.0 cors@^2.8.6 cookie-parser@^1.4.7 telegram@2.26.22 \
  @flashbots/ethers-provider-bundle@1.0.0
npm uninstall uuid @types/uuid ts-node chai @types/chai @types/mocha typechain @typechain/ethers-v6 \
  @typechain/hardhat hardhat-gas-reporter solidity-coverage @nomicfoundation/hardhat-toolbox \
  @nomicfoundation/hardhat-ethers @nomicfoundation/hardhat-chai-matchers \
  @nomicfoundation/hardhat-network-helpers @nomicfoundation/hardhat-ignition-ethers @nomicfoundation/ignition-core

# Dev deps
npm install -D hardhat@^3.21.2 @nomicfoundation/hardhat-ignition@^3.1.9 @nomicfoundation/hardhat-verify@^3.1.4 \
  @nomicfoundation/hardhat-keystore@^3.1.2 @openzeppelin/contracts@5.4.0 \
  "typescript@npm:@typescript/typescript6@^6.0.2" "@typescript/native@npm:typescript@^7.0.2" \
  typescript-eslint@^8.72.1 eslint@^10.14.0 @eslint/js@^10.0.1 @vitest/eslint-plugin@^1.6.28 \
  eslint-plugin-react-hooks@^7.1.1 eslint-plugin-react-refresh@^0.5.7 globals@^17.14.0 \
  vitest@^5.1.0 @vitest/coverage-v8@^5.1.0 vite@^8.3.6 \
  prettier@^3.9.10 prettier-plugin-tailwindcss@^0.8.1 \
  knip@^6.44.1 dependency-cruiser@^18.7.2 type-coverage@^2.31.2 lefthook@^2.2.2 \
  @types/node@^24.10.0 @types/better-sqlite3@^9.6.0 @types/express@^5.0.6 @types/cors@^2.8.19 \
  @types/cookie-parser@^1.4.10 @types/ws@^8.18.2 pino-pretty@^13.2.0
# NOTE: move @types/express out of "dependencies" (currently listed in both)
```

package.json additions:
```json
{
  "type": "module",
  "engines": { "node": ">=24.12.0" },
  "packageManager": "npm@11.16.0",
  "overrides": { "@flashbots/ethers-provider-bundle": { "ethers": "$ethers" } },
  "allowScripts": { "better-sqlite3": false, "es5-ext": false, "esbuild": true, "bufferutil": true, "utf-8-validate": true, "lefthook": true },
  "scripts": {
    "start": "node --enable-source-maps src/bot.ts",
    "preflight": "node scripts/preflight.ts", "pause": "node scripts/pause.ts", "resume": "node scripts/resume.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p dashboard/tsconfig.json",
    "lint": "eslint . --max-warnings=0",
    "format": "prettier --write .", "format:check": "prettier --check .",
    "knip": "knip", "depcruise": "depcruise src --config .dependency-cruiser.cjs",
    "type-coverage": "type-coverage --strict --at-least 99 --detail",
    "audit:prod": "npm audit --omit=dev --audit-level=low && npm audit signatures"
  }
}
```

**`@types/node`:** use `^24.x` while Node 24 is the floor. Do **not** use 26.x types until the floor moves to 26, because they would type-allow APIs that the floor runtime lacks. `@types/node` 26.6.6 is the latest [REG], and Vitest's peer accepts `>=24`.

---

## Alternatives Considered

| Recommended | Alternative | When the alternative wins |
|-------------|-------------|---------------------------|
| TS 7 `tsc` + TS 6 API alias | TS 6.0.3 only | If the dual-compiler setup ever disagrees (TS 7 claims parity with 6.0 under `stableTypeOrdering`), fall back to 6.0.3 alone until TS 7.1. |
| Whole-repo ESM | Nested `contracts/` package with its own `"type":"module"` (npm workspace) | Only if the ESM conversion turns out to be blocked by something not found here. That would also move the artifact paths the fork tests use. |
| Node type stripping (`node src/bot.ts`) | tsx 4.23 | If a dependency or pattern ever needs non-erasable TS syntax. |
| Node type stripping | Compiled `dist/` (`tsc` 7 emit plus `node dist/bot.js`) | If you need a shipped artifact on another host. Not the case: it is a single local machine. |
| Prettier 3.9 | Biome 2.6.6 (formatter only) | If formatting speed on a much larger monorepo mattered. Biome's Tailwind sorting is a lint rule rather than format-time sorting, and adopting it means a second config dialect alongside ESLint. |
| lefthook | husky 9.1.7 + lint-staged 17.6 | If the team standardizes on them elsewhere. Here they are two tools doing one job. |
| Dependabot | Renovate | If you want a dependency dashboard, `lockFileMaintenance`, or regex managers. Dependabot is native, zero-install, and now has `cooldown`. |
| dependency-cruiser | eslint-plugin-boundaries 7.4 | If you want boundary errors in the editor. dependency-cruiser also does cycles, orphans, and graph output, which the restructure needs. |
| Keep @flashbots/ethers-provider-bundle with `overrides` | **In-repo `FlashbotsRelayClient`** (`eth_callBundle`, `eth_sendBundle`, inclusion polling via receipts), reusing the existing `rawSendBundle` signing | **Recommended within v7.0 as an explicit, operator-approved money-path change**, after characterization tests and with a fork plus relay rehearsal. It removes an unmaintained CJS dependency, the dual-ethers hazard, the exact peer pin, and a dead 403 endpoint. Until then, `overrides` drops `--legacy-peer-deps` with no code change. |
| axios 1.21 | Native `fetch` (undici, built in) | Long term, yes: axios needed 32 advisories fixed in 5 months. Its behavior differs, though (throw-on-non-2xx, timeout, error shape), and it sits on the bloXroute and safety-provider paths. Make that an explicit decision with characterization tests, starting with non-money sites (notifier, CLIs). |
| dotenv 18 | `process.loadEnvFile()` (Node built-in) | Removes a dependency, but its parser differs from dotenv. Not worth the risk on a `PRIVATE_KEY` file. |

---

## What NOT to Use

| Avoid | Why | Use instead |
|-------|-----|-------------|
| `typescript@^7` as the plain `typescript` package | Breaks typescript-eslint (ERESOLVE, then a "reading 'Cjs'" crash), type-coverage, and dependency-cruiser [DOC/REG] | The alias layout above |
| `@typescript/native-preview` / `tsgo` | Preview channel, superseded by stable `typescript@7` [REG/DOC] | `typescript@7.0.2` (as `@typescript/native` alias) |
| `ts-node` 10.9.2 | No TS 7 support, stagnant, an extra process layer (the Ctrl+C issue) | `node file.ts` |
| `@nomicfoundation/hardhat-toolbox` 7 / `hardhat-toolbox-mocha-ethers` 4 | Pulls mocha, chai, typechain, matchers, and network-helpers, none of which this repo uses | Individual plugins: ignition, verify, keystore |
| `hardhat-gas-reporter`, `solidity-coverage` | Hardhat 2 peers only [REG] | Nothing (no Hardhat tests). HH3 built-ins if Solidity tests are ever added. |
| `typechain` / `@nomicfoundation/hardhat-typechain` | Generated types are never imported | Centralized ABIs (INFRA-03) |
| `chai`, `@types/chai`, `@types/mocha` | Unused, since Vitest has its own expect | — |
| `uuid`, `@types/uuid` | ESM-only package plus a deprecated stub, with one call site | `crypto.randomUUID()` |
| `@openzeppelin/contracts@5.6.x` in v7.0 | Changes the tested checker away from the deployed one | Pin 5.4.0; bump in HONEY-04 |
| `--legacy-peer-deps` / `--force` | Hides real conflicts; the only real one has a targeted fix | `overrides` for the flashbots peer |
| `npm audit` (full tree) as a gate | The zod 3 (Hardhat) and minimatch (ESLint) advisories have no fix, so the gate could never pass | `npm audit --omit=dev --audit-level=low` plus `npm audit signatures` |
| `actions/dependency-review-action` | Runs only on PRs, and this repo commits straight to master (no branching) | A scheduled weekly CI run of `audit:prod`, because advisories land without code changes |
| osv-scanner | Duplicates the GitHub Advisory DB that `npm audit` already uses; it is not an npm package (Go binary or action) | `npm audit --omit=dev` |
| `getBundleStatsV2` (flashbots_getBundleStatsV2) | Returns 403 since 2025-06-09 [WEB/DOC flashbots-docs #638] | Remove the call; reconcile via receipts and `eth_getTransactionReceipt` |
| `eslint-config-prettier` | Not needed with typescript-eslint presets (no stylistic rules) | — |
| Prettier 4 alpha, Biome nightly, TS 7.1 beta | Pre-release on a money codebase | Stable channels |

---

## Upgrade Order (what must precede what)

0. **Safety prerequisite:** back up `ignition/deployments/` and decide whether to track `journal.jsonl` and `artifacts/`. Capture the current `npm ls` and audit baselines.
1. **Vulnerability and peer cleanup** (no majors, no module change). Do this first, since it is independent of everything else.
   - Bump ethers 6.17, axios 1.21, ws 8.22, express 5.3, and the other minors.
   - Replace uuid with `crypto.randomUUID`.
   - Remove the dead dev deps (chai, @types/chai, @types/mocha, typechain, gas-reporter, solidity-coverage).
   - Add the flashbots `overrides`, `allowScripts`, and `packageManager`.
   - Regenerate the lockfile.
   - Result: 0 prod vulns, and `npm ci` works without `--legacy-peer-deps`.
2. **Vitest 5**, still on CJS, so the referee suite changes under only one variable. Get green and fix any unawaited assertions it exposes.
3. **TS 6 bridge, ESLint 10, typescript-eslint 8.72.** Consolidate tsconfigs, include `test/` and `scripts/`, set `moduleResolution: nodenext`, and add `defineConfig`. Land the lint config, but the gate stays non-blocking until lint reaches zero.
4. **Prettier reformat** as one isolated commit plus `.git-blame-ignore-revs`. Exclude `contracts/` (it is verified source), `.planning/`, `ignition/deployments/`, and `test/fork/fixtures/`. Do this **before** the deep restructure so later diffs are format-stable.
5. **ESM, ts-node removal, and Node type stripping, together.** The runner choice depends on the module system, and both touch every import.
   - `"type":"module"`, the `.ts`-extension codemod, `verbatimModuleSyntax`, and `erasableSyntaxOnly`.
   - Fix the `__dirname`, `require.main`, and gramjs-subpath sites.
   - Add the real-Node import smoke (P-4).
   - Must precede step 6.
6. **Hardhat 3** (needs ESM). New config with pinned profiles, `paths.sources`, `configVariable`, and keystore. Then fork-suite parity check, Ignition `status chain-1` on a copy, and the replacement toolbox-config test.
7. **TS 7 dual install.** The CI typecheck switches to TS 7 `tsc`. Both `tsc` (7) and `tsc6` must be clean, in CI for one cycle. Dashboard deps, including lucide 1.x and TS 7, can go in parallel from step 3 onward.
8. **Quality tooling.** knip and type-coverage now. dependency-cruiser rules go in **with the restructure's domain layout**, since boundaries cannot be written before the domains exist. Then lefthook and Dependabot.
9. **CI hardening last.** Each gate flips to blocking once its baseline reaches zero: lint, format:check, typecheck (TS 7), audit:prod, knip, depcruise, type-coverage, and coverage floors. Bump the actions and pin them by SHA. Add the Node 24/26 matrix and the weekly scheduled audit.
10. **(Operator decision) Flashbots client replacement**, after characterization tests. Fork rehearsal is mandatory, and the live roundtrip re-proof covers it.

---

## CI Target (`.github/workflows/test.yml`)

| Action | Current | Latest (verified via `gh api`) |
|--------|---------|--------------------------------|
| actions/checkout | v4 | **v7.0.1** (2026-07-20) |
| actions/setup-node | v4 | **v7.1.0** (2026-10-08). v7.0.0 moved to ESM and removed the dummy `NODE_AUTH_TOKEN` export. |
| actions/setup-python | v5 | **v7.1.0** (2026-10-22) |
| dorny/paths-filter | v3 | **v4.0.3** (2026-08-05) |
| actions/cache / upload-artifact | (unused) | v6.1.0 / v7.0.2, used for coverage reports |

- Pin every action to a full commit SHA with a `# v7.0.1` comment, and let Dependabot's github-actions ecosystem bump them. A money repo should not trust movable tags.
- Use `node-version: [24, 26]` as a matrix on the test job, `npm ci` with no flags, and `cache: npm`.
- Steps: `format:check` → `lint` → `typecheck` → `test:unit` → `test:integration` → `test:coverage` (floors) → `knip` → `depcruise` → `type-coverage` → `audit:prod` → real-Node import smoke. Keep the existing `.todo` ban and root-doc ban.
- In the contracts job, replace `npx hardhat compile` with `npx hardhat build`, and run the mythril gate with `node scripts/check-mythril-report.ts`. Keep `solc-select 0.8.28`. Slither and mythril read sources directly and are unaffected by Hardhat 3, but **slither uses the `node_modules/@openzeppelin` remap, so it needs OZ pinned** (see above).
- Add `on: schedule: - cron: '0 6 * * 1'` running `audit:prod`.

---

## Cross-Cutting Pitfalls Found During Stack Research

- **P-1 Bytecode parity:** HH3 defaults (`cancun`, plus optimizer on in the Ignition `production` profile) silently diverge from the deployed checker (`paris`, optimizer off). Pin both profiles, and add a unit test that asserts it.
- **P-2 Untracked deployment state:** `ignition/deployments/*/journal.jsonl` and `*/artifacts/` are gitignored, so the only copy is local. Back them up before any Hardhat or Ignition operation.
- **P-3 `npm ci` vs better-sqlite3 13:** without `allowScripts`, npm runs node-gyp. It fails on Windows and wastes time on Linux.
- **P-4 The green suite masks ESM runtime breaks:** Vitest 5 shims `require` and `__dirname` inside test files even under `"type":"module"` [EXEC]. A leftover `__dirname` in `src/api/routes/health.ts`, or a gramjs directory import, will pass every test and then crash `node src/bot.ts`. Add a CI step that runs a small `scripts/import-smoke.ts` under **real Node**. It should dynamically import every `src/**` module except entry points (`bot.ts` is guarded by `import.meta.main`, but per the operator rule never boot it), plus `node scripts/preflight.ts --help`-style no-RPC checks where available. This is the same failure mode as the project memory note "green suite misses money-path bugs".
- **P-5 Dual ethers instances:** under ESM the bot loads `ethers/lib.esm`, while @flashbots/ethers-provider-bundle `require`s `ethers/lib.commonjs`. Duck-typed calls work, but any `instanceof` or class identity check across that boundary would fail. Fork-rehearse the Flashbots path after the ESM step, or replace the library.
- **P-6 Dead telemetry:** `flashbotsProvider.getBundleStatsV2` (`src/utils/mevStrategies/flashbots.ts:345`) has returned 403 since 2025-06-09. This is an audit-register finding.

## Sources

- npm registry (`npm view` versions, peers, engines, exports, `time`) for every version in this file, queried 2026-11-06 [REG, HIGH]
- Published tarballs inspected: `hardhat@3.21.2`, `@nomicfoundation/ignition-core@3.1.11`, `@nomicfoundation/hardhat-ignition@3.1.9`, `better-sqlite3@13.0.3` [EXEC, HIGH]
- Local executions: fresh-resolve ERESOLVE (flashbots peer), the target manifest resolving clean plus `audit --omit=dev` = 0, the `npm ci` vs `npm install` better-sqlite3 trap and the `allowScripts` fix, ESM import smoke of all prod deps, TS 7 emit and TS 6 alias with typescript-eslint, Vitest 5, Node type stripping, tsx [EXEC, HIGH]
- [TypeScript 7.0 announcement (devblogs, 2026-07-08)](https://devblogs.microsoft.com/typescript/?p=5246): side-by-side alias, removed options, new defaults [DOC]
- [TypeScript 7.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/): `@typescript/typescript6` compatibility package [DOC]
- [InfoQ: TypeScript 7 released](https://infoq.com/news/2026/08/typescript-7-released/): no API until 7.1 [WEB]
- [typescript-eslint #12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518): TS 7 unsupported, blocked by #10940 [DOC]
- [Hardhat: migrate from Hardhat 2](https://hardhat.org/migrate-from-hardhat2): ESM config, `defineConfig`, plugins array, hooks replace subtasks [DOC]
- Context7 `/websites/hardhat` and `/nomicfoundation/hardhat`: `type: "http"`/`"edr-simulated"`, `verify.etherscan`, `configVariable`, Solidity-tests-in-`test/` rule, `--coverage`/`--gas-stats` [DOC]
- [Vitest migration guide](https://vitest.dev/guide/migration): v5 breaking changes [DOC]
- [ESLint v10 migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0) [DOC]
- [Node.js TypeScript docs](https://nodejs.org/api/typescript.html): type stripping Stable in v24.12.0 / v25.2.0, limitations [DOC]
- [Node.js release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json): 24 maintenance 2026-10-20, 26 LTS 2026-10-28 [DOC]
- [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases): v13 N-API and bundled prebuilds [DOC]
- [dotenv CHANGELOG](https://github.com/motdotla/dotenv/blob/master/CHANGELOG.md): 18.0.0 changes [DOC]
- [Flashbots bundle-stats deprecation](https://collective.flashbots.net/t/deprecation-of-bundle-stats-api-methods-in-flashbots-protect/4973) and [flashbots-docs PR #638](https://github.com/flashbots/flashbots-docs/pull/638): `getBundleStatsV2` returns 403 [WEB, cross-verified]
- [npm approve-scripts docs](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/) / [npm install-scripts](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts): `allowScripts` [DOC]
- [Dependabot options reference](https://docs.github.com/en/enterprise-server@3.19/code-security/reference/supply-chain-security/dependabot-options-reference): `cooldown` [DOC]
- [lucide 1.0 coverage (DEV)](https://dev.to/davekurian/lucide-10-removes-brand-icons-and-optimizes-bundle-size-for-millions-of-projects-3n96): brand icons removed [WEB, LOW]
- GitHub Actions latest tags via `gh api repos/<action>/releases/latest` [EXEC, HIGH]

---
*Stack research for: v7.0 Full Audit & Modernization*
*Researched: 2026-11-06*
