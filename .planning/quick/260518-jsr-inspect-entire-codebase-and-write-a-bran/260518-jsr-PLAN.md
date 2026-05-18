---
quick_id: 260518-jsr
title: Brand-new README.md for crypto-snipe-bot
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - README.md
autonomous: true
mode: quick-full
requirements:
  - QUICK-260518-jsr

must_haves:
  truths:
    # Identity / shape
    - "Project name is 'Crypto Snipe Bot' (per package.json:2)"
    - "README is engineer-first in tone (per CONTEXT D-AUDIENCE: lead with architecture, stack, depth; product framing concise at top)"
    - "README is ~500–800 lines (per CONTEXT D-DEPTH comprehensive deep-dive)"
    - "README is prose+bullets only — NO ASCII diagrams, NO Mermaid, NO code snippets in README (per CONTEXT D-VISUAL); a *small* markdown table for tabular data such as the chain-support matrix is allowed only when more readable than prose, never for code"
    - "Every major claim is grounded in actual code paths from RESEARCH §17 (Work-Process step 4)"
    - "WIP features are marked inline with explicit status tags (e.g. 'Status: In Progress' or '— WIP') and a one-line truthful description of where they actually stand today (per CONTEXT D-WIP)"

    # Multi-chain support
    - "Multi-chain support: ETH, BSC, Base, Arbitrum — 4 chains (per RESEARCH §7 table + chainRegistry CHAIN_TEMPLATES at src/chainRegistry.ts:121-296)"
    - "MEV strategies are chain-aware: Flashbots on ETH, bloXroute on BSC, passthrough (native private mempool) on Base and Arbitrum (per RESEARCH §7 + src/utils/mevStrategies/)"
    - "DEX coverage spans Uniswap V2 + V3, SushiSwap, PancakeSwap, BiSwap, Aerodrome, Camelot (per RESEARCH §7 table)"

    # Detection + execution
    - "WebSocket-first listener on PairCreated (V2) and PoolCreated (V3) with exponential-backoff reconnect (1s → 60s cap); 2s HTTP polling fallback when no WS URL (per RESEARCH §13 + src/bot.ts:542-637 / src/bot.ts:644-696)"
    - "Entry point is `npx ts-node src/bot.ts` which invokes `startMultiChainBot()` (per src/bot.ts:949-951 and project_start_command memory)"

    # Safety stack
    - "Pre-buy safety bank is an 8-call Promise.all per candidate (honeypot, liquidity-lock, bytecode anti-bot selectors, reserve depth (V2), token metadata sanity, staticCall buy-direction roundtrip, transfer-tax probe, max-wallet/max-tx probe) (per RESEARCH §8 + §13)"
    - "Third-party safety APIs integrated: honeypot.is (ETH/Base), GoPlus Security (all chains), Unicrypt liquidity lock (ETH), Mudra liquidity lock (BSC) (per RESEARCH §2 + §7)"
    - "HoneypotChecker.sol is an immutable, stateless, eth_call-only revert-always Solidity contract for pre-buy roundtrip simulation (V2 + V3 entry points, 3-bit status bitmap, custom errors) — Status: Audited (Slither + Mythril clean, 2026-05-15), deployed pipeline shipped, runtime wire-up at src/bot.ts:229 is still WIP under plan 18-09 (per RESEARCH §6 + §14)"

    # Risk
    - "5-rule risk gate, first-failure-returns: position size, rolling 24h daily-loss circuit breaker per chain, global max open positions, per-chain snipe cooldown, portfolio total-exposure cap (per RESEARCH §5 riskManager.ts + §13)"

    # Exit engine
    - "Unified exit engine with one 5s poll per position covers trailing stop (volatility-CoV widened, age-weighted urgency tightened, clamped to min/max band), configurable partial-sell tiers (e.g. '2x:50,5x:25') with gap-sell handling, stop loss active until trailing activates at 2× entry, and time-urgency hard market sell at 30 min (per RESEARCH §5 exitEngine.ts + §13)"
    - "Exit state is persisted to the exit_state SQLite table every poll cycle so restart resumes with high-water mark, completed tiers, original amount, urgency anchor, and volatility samples intact (per RESEARCH §9 + §13)"
    - "Per-token sell mutex on composite chain:token keys eliminates the same-tick double-sell race (per RESEARCH §13 + src/utils/exitManager.ts)"

    # Persistence
    - "Persistence uses SQLite via better-sqlite3 with WAL journal mode; schema migrations run at module load up to version 4; one-shot legacy `.bot-state.json → SQLite` migration on first boot (per RESEARCH §2 + §9 + src/utils/db.ts)"
    - "Computed P&L via single self-join over the trades table, pro-rating buy cost across partial sells (per RESEARCH §9 + src/utils/db.ts:241-274)"

    # Dashboard
    - "Operator dashboard is React 19 + Vite + Tailwind 4, served by Express on `127.0.0.1:8080` by default (operator-only, no SaaS / multi-tenant) (per RESEARCH §1 + §2 dashboard package + §10 DASHBOARD_HOST/PORT)"
    - "Dashboard auth uses `timingSafeEqual` against DASHBOARD_API_KEY + httpOnly cookie + UUID session with 24h TTL; sessions live in an in-memory Map with hourly cleanup (per RESEARCH §5 src/api/middleware/auth.ts + §13)"
    - "WebSocket push: 5s `positions_update`, on-event `chain_status_change`, every Telegram alert fans out as `notification` with inferred severity/category (per RESEARCH §5 src/api/ws/ + §13)"

    # Telegram
    - "Telegram MTProto user-account listener (`telegram` 2.26.22 / GramJS) extracts every `0x[a-fA-F0-9]{40}` from inbound messages, deduplicates with a 5s cooldown, applies sender/channel allowlists, and routes each address to every chain where getCode(address)≠'0x' (per RESEARCH §5 src/telegramListener.ts + src/alphaDrop.ts)"
    - "Outbound Telegram alerts use the plain Telegram HTTP API via axios (per RESEARCH §2 src/utils/notifier.ts)"

    # Smart contract / audit pipeline
    - "HoneypotChecker has no owner, no proxy, no killSwitch, no selfdestruct, no tx.origin — patch path is 'deploy v2 at a new address and update env' (per RESEARCH §6 D-CONTRACT-IMMUTABLE)"
    - "Slither + Mythril run as CI gates on every `contracts/**` change via `dorny/paths-filter@v3` in `.github/workflows/test.yml`; Mythril severity is enforced by `scripts/check-mythril-report.ts` (zero new npm deps) (per RESEARCH §12)"
    - "Deploy uses a capability-split `DEPLOY_PRIVATE_KEY` (separate from the bot wallet's PRIVATE_KEY) on the production hardhat networks; sepolia continues to use PRIVATE_KEY for test-only deploys (per RESEARCH §6 + §10)"

    # Tests / CI
    - "Tests use Vitest 4 across three projects (unit / integration / fork), 43 *.test.ts files total (29 unit + 13 integration + 1 fork), with a 70% lines/functions/branches/statements coverage threshold and v8 provider (per RESEARCH §11)"
    - "CI invariants include a `.todo` test-stub ban and three `tsc --noEmit` invocations (root + bot + dashboard) on every push/PR (per RESEARCH §11 + §12)"

    # Security / reliability
    - "CSV export at `/api/trades/export` escapes `= + - @ \\t \\r` prefix-attack vectors for spreadsheet-formula-injection safety (per RESEARCH §5 src/api/routes/trades.ts + §15)"
    - "Graceful shutdown on SIGINT/SIGTERM closes the API server, disconnects Telegram, clears all exit timers, destroys WebSocket providers, closes the DB, then exits — with a 5s force-exit safety net (per RESEARCH §3 + §13)"
    - "Env validation is fail-loud at startup (`logger.fatal + process.exit(1)`) for missing required vars and out-of-range tax bps (per RESEARCH §3 + §10)"

    # In-progress framing
    - "Pre-buy sell-simulation rebuild is Phase 18 mid-flight: contract audited and CI-gated, deploy pipeline shipped, runtime wire-up at `src/bot.ts:229` and `src/utils/honeypot/checkerContract.ts` is pending plan 18-09 — the README must say this truthfully and must NOT describe `simulateSellForChain` / `simulateSellV3ForChain` as working (per RESEARCH §14 + STATE.md Current Position)"
    - "Anti-rug runtime monitoring (Phase 19 ANTIRUG) is NOT started — no code in `src/` for it yet (per RESEARCH §14)"
    - "Going-live ops hardening (Phase 20 OPS-LIVE) is partial — the GOING-LIVE.md runbook is at repo root with wallet pre-flight + stale-data warnings + planned move to docs/operations/ still pending (per RESEARCH §14 + STATE.md)"

    # Out-of-scope / anti-patterns (must NOT appear)
    - "README does NOT include code snippets, ASCII diagrams, or Mermaid (per CONTEXT D-VISUAL)"
    - "README does NOT include a clone/fork boilerplate section (per readme-prompt.md Important Constraints)"
    - "README does NOT describe `simulateSellForChain` / `simulateSellV3ForChain` as working (they are deliberate broken-by-design stubs per RESEARCH §14)"
    - "README does NOT describe Phase 19 anti-rug as implemented"
    - "README does NOT add badges that link to external CI/coverage/registry services unless the workflow + service is verifiably configured (per CONTEXT Claude's Discretion)"
    - "README does NOT oversell the `contracts/` footprint beyond `HoneypotChecker.sol` + `FakeToken.sol`"
    - "README does NOT invent features outside RESEARCH §13 (the complete shipped feature list)"

  artifacts:
    - path: "C:/Users/jackc/WebstormProjects/crypto-snipe-bot/README.md"
      provides: "Brand-new, engineer-first README for the crypto-snipe-bot repository"
      min_lines: 500
      max_lines: 850
      committed: true

  key_links:
    - from: "README.md → Architecture / Entry point claim"
      to: "src/bot.ts (orchestrator)"
      via: "engineer-prose reference"
      pattern: "src/bot\\.ts"
    - from: "README.md → Chain support claim"
      to: "src/chainRegistry.ts (CHAIN_TEMPLATES)"
      via: "engineer-prose reference"
      pattern: "chainRegistry"
    - from: "README.md → Unified exit engine claim"
      to: "src/exitEngine.ts"
      via: "engineer-prose reference"
      pattern: "exitEngine"
    - from: "README.md → Safety bank claim"
      to: "src/utils/tokenSafety.ts"
      via: "engineer-prose reference"
      pattern: "tokenSafety"
    - from: "README.md → Phase 18 honeypot dispatch claim"
      to: "src/utils/honeypot/"
      via: "engineer-prose reference (must explicitly note Status: In Progress for the runtime wire-up)"
      pattern: "honeypot"
    - from: "README.md → Audited contract claim"
      to: "contracts/honeypot/HoneypotChecker.sol"
      via: "engineer-prose reference (Slither + Mythril clean)"
      pattern: "HoneypotChecker\\.sol"
    - from: "README.md → CI audit gate claim"
      to: ".github/workflows/test.yml"
      via: "engineer-prose reference (paths-filter + slither + mythril)"
      pattern: "test\\.yml|workflows"
    - from: "README.md → Stack source of truth"
      to: "package.json"
      via: "engineer-prose reference (versions match)"
      pattern: "package\\.json|TypeScript|ethers|better-sqlite3|express"
---

<objective>
Replace the root `README.md` of the `crypto-snipe-bot` repository with a brand-new, engineer-first, technically dense README that accurately represents the codebase as it stands on 2026-05-18.

**Purpose:** The README is read by engineers, technical interviewers, and hiring managers. It must sound polished, credible, and impressive while remaining strictly truthful — every major claim is grounded in the file-path map in `260518-jsr-RESEARCH.md` §17. WIP features (notably the Phase-18 honeypot-detection rebuild and Phase-19 anti-rug monitoring) are surfaced inline with explicit status tags, not hidden in a roadmap dump.

**Output:** A single committed artifact, `C:/Users/jackc/WebstormProjects/crypto-snipe-bot/README.md`, ~500–800 lines, prose + bullets only (no ASCII diagrams, no Mermaid, no code snippets in the body — a small markdown table is acceptable only where it materially beats prose, e.g. the chain × DEX × MEV-strategy matrix).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@C:/Users/jackc/WebstormProjects/crypto-snipe-bot/readme-prompt.md
@C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/quick/260518-jsr-inspect-entire-codebase-and-write-a-bran/260518-jsr-CONTEXT.md
@C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/quick/260518-jsr-inspect-entire-codebase-and-write-a-bran/260518-jsr-RESEARCH.md
@C:/Users/jackc/WebstormProjects/crypto-snipe-bot/.planning/STATE.md
@C:/Users/jackc/WebstormProjects/crypto-snipe-bot/package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write the brand-new README.md and commit atomically</name>
  <files>C:/Users/jackc/WebstormProjects/crypto-snipe-bot/README.md</files>

  <action>
Overwrite `C:/Users/jackc/WebstormProjects/crypto-snipe-bot/README.md` with a brand-new, engineer-first README. Read the four context files in `<context>` first (`readme-prompt.md`, `260518-jsr-CONTEXT.md`, `260518-jsr-RESEARCH.md`, `STATE.md`, `package.json`). RESEARCH.md is the **single source of truth for content**; the brief in `readme-prompt.md` and the decisions in `CONTEXT.md` control tone and shape.

Honor these locked decisions from CONTEXT (NON-NEGOTIABLE):
- **D-AUDIENCE — engineer-first.** Lead with architecture, stack, and technical depth. Keep product/business framing tight at the top so hiring managers can scan in 30 seconds, but the body is technical and dense. No marketing voice. Write like a senior engineer documenting a serious system.
- **D-WIP — mark explicitly as WIP inline.** Implemented features go into main sections with confident prose. In-progress features get an inline status tag (e.g. `**Status:** In Progress` or `— WIP`) and a one-line truthful description of where they actually stand today. Never invent features. Never describe roadmap aspirations as if implemented.
- **D-DEPTH — comprehensive deep-dive (~500–800 lines).** Substantial Feature Deep Dive, real Architecture Overview, and Data/Domain Model coverage. Polished, not bloated — cut any section the codebase cannot support with real evidence.
- **D-VISUAL — prose + bullets only.** No ASCII diagrams. No Mermaid. No code snippets in the README body. Lean on strong heading hierarchy, short paragraphs, and well-labeled bullets. A small markdown table is acceptable only where it is materially more readable than prose — e.g. the chain × DEX × MEV-strategy matrix from RESEARCH §7. Do **not** use tables to fake a code snippet.

Use this section ordering (engineer-first):

1. **Title + one-line tagline.** "Crypto Snipe Bot" — short, no hype. The tagline must be technically grounded (e.g. mention multi-chain EVM token-launch detection with on-chain safety + MEV-protected execution) and back-able by RESEARCH §1. Choose a clean professional title; do not invent a tagline the project does not back up (CONTEXT Claude's Discretion).
2. **Overview** (3–5 sentences) — pulled from RESEARCH §1. What it is, who it serves (the operator/developer themselves — no multi-tenant story), what problem it solves, why it is technically interesting.
3. **Status snapshot** — short honest paragraph noting what is shipped today and that a v6.17 defensive-hardening milestone (audited on-chain `HoneypotChecker` contract, deploy pipeline, CI audit gate) is **mid-rollout**: contract done, audit clean, runtime wire-up at `src/bot.ts:229` pending plan 18-09. Pull truthfully from RESEARCH §14 and STATE.md.
4. **Key Features** — grouped logically. Suggested groupings (final naming is your discretion, but groupings must emerge naturally from the codebase per CONTEXT Claude's Discretion):
   - Multi-Chain Detection & Execution
   - Pre-Buy Safety Stack
   - Risk Management
   - Unified Exit Engine
   - MEV-Protected Transaction Submission
   - Persistence & Audit Trail
   - Operator Dashboard
   - Telegram Integration
   - Smart Contract & Audit Pipeline
   - Operational Hardening
   Be specific. Reflect what exists in code today (RESEARCH §13 is the complete shipped feature list). For WIP areas, tag inline.
5. **Technical Highlights / Why This Project Stands Out** — call out the architectural decisions from RESEARCH §15 that read well in interviews: discriminated-union chain/DEX abstractions, layered MEV strategy, `HoneypotResult` as a compile-gate vacuous-pass guard, single source-of-truth chain registry, immutable eth_call-only on-chain checker, capability-split deploy key, restart-survivable exit state machine, per-token sell mutex, audit-gate-as-evergreen-CI-invariant, receipt-decoded P&L, defense-in-depth env handling, formula-injection-safe CSV export.
6. **Architecture Overview** — bullet structure with brief subsections covering the major layers (Bot orchestrator, Chain registry & ChainContext, MEV strategy layer, Safety stack, Risk gate, Unified exit engine, Persistence & migrations, Dashboard API + WebSocket, Telegram listener, Smart-contract audit pipeline). Prose + bullets only. Sourced from RESEARCH §3, §5, §15.
7. **Tech Stack** — grouped (Runtime, Blockchain, Smart contracts & Hardhat, Web framework / dashboard backend, Dashboard frontend, Telegram, Observability, Testing & lint, Other). Pull versions from `package.json` and `dashboard/package.json` as cited in RESEARCH §2. Do not list every transitive — name the choices that matter and why.
8. **Feature Deep Dive** — for each major subsystem from §4: what it does, how it works, notable implementation details. Be specific. Reference file paths sparingly in prose (do not dump every reference). Cover at minimum: multi-chain detection (WS + reconnect + HTTP fallback + V3 liquidity wait), pre-buy safety bank (8-call Promise.all), the in-flight Phase 18 honeypot pipeline (Option D primary + Option C opt-in fallback + audited contract + dispatcher + bytecode-mutability scan + WIP runtime wire-up), risk gate (5 rules), MEV strategies (per chain), unified exit engine (trailing stop + partial tiers + volatility CoV + urgency + state persistence + sell mutex), receipt decoder, dashboard + WebSocket, Telegram listener + alpha-drop pipeline, persistence + P&L.
9. **Data & Domain Model** — SQLite schema (`trades`, `exit_state`) summarized from RESEARCH §9, plus key TypeScript domain types from RESEARCH §9 "Domain types" subsection (`ChainConfig`, `DexConfig` discriminated union, `ChainContext`, `HoneypotResult` discriminated union, `HoneypotCheckerConfig`, `ExitConfig`, `ExitStateData`, `PartialTier`, `MevStrategy`, `ReceiptData`). Explain the P&L self-join approach from `getPnL()` in `src/utils/db.ts:241-274`.
10. **Chain & DEX Support** — small markdown table is acceptable here per the discretion clause if it improves readability over prose. Use the chain × native × WETH × MEV strategy × V2 DEXes × V3 DEXes shape from RESEARCH §7. Add a short paragraph after the table noting that all router/factory/quoter addresses are hardcoded in `CHAIN_TEMPLATES` at `src/chainRegistry.ts:121-296` and that each chain has its own gas profile, default snipe amount, default max capital, default min liquidity, and default tax thresholds.
11. **Security & Reliability** — auth (timingSafeEqual + httpOnly cookie + UUID session + hourly cleanup), validation (fail-loud env at startup + re-validated at login), MEV protection per chain, sell mutex, capability-split deploy key, audit gate (Slither + Mythril on contracts/** path filter), formula-injection-safe CSV export, graceful shutdown, chain-scoped logger. Sourced from RESEARCH §15.
12. **In-Progress Work** — short summary section (inline WIP tags in earlier sections do most of the work). List:
    - Pre-buy sell-simulation rebuild (Phase 18 mid-flight — contract audited 2026-05-15, deploy pipeline shipped, runtime wire-up at `src/bot.ts:229` and `src/utils/honeypot/checkerContract.ts` pending plan 18-09)
    - Anti-rug runtime monitoring (Phase 19 ANTIRUG, **not started** — no code in `src/` for this yet)
    - Going-live ops hardening (Phase 20 OPS-LIVE, partial — `GOING-LIVE.md` at repo root with wallet pre-flight + stale-data warnings + planned move to `docs/operations/` still pending)
    - v6.16 deferred live-runtime validation (Phase 21 EXIT-LIVE) — items validated only in tests during v6.16 that need real-mainnet validation
13. **Project Structure** — top-level directories with one-line descriptions, drawn from RESEARCH §4. Keep useful, not exhaustive noise. Pick top-level + selective depth-2 only where it adds clarity (CONTEXT Claude's Discretion).
14. **Tests & CI** — Vitest 4 with three projects (unit/integration/fork), 43 *.test.ts files, 70% coverage threshold (v8 provider), `.todo` ban + three `tsc --noEmit` invariants, Slither + Mythril gate on `contracts/**`, Mythril severity gate via `scripts/check-mythril-report.ts` (zero new npm deps). Note that fork tests are excluded from CI (require RPC). Sourced from RESEARCH §11–§12.
15. **Running the Bot** — short section. Entry point is `npx ts-node src/bot.ts`. Env vars overview pointing to `.env.example` (33 documented variables, all listed in RESEARCH §10). Dashboard build step is `cd dashboard && npm run build` then Express serves the static `dashboard/dist/`. Do NOT spend much space on cloning/forking (per readme-prompt.md).
16. **Conclusion** — 3–5 sentences. Technically confident, no hype, no "this project demonstrates" filler. Frame the engineering arc: multi-chain abstraction + chain-aware MEV + state-machine resilience + audited on-chain safety primitive, with v6.17 closing the last credibility gap on the safety stack. Pick phrasing yourself (CONTEXT Claude's Discretion).

Anti-patterns to avoid (verifier and post-write check will reject these):
- NO ASCII diagrams, NO Mermaid, NO fenced code blocks in the README body (CONTEXT D-VISUAL)
- NO clone/fork boilerplate section (readme-prompt.md Important Constraints)
- NO badges that link to external CI/coverage/registry services unless verifiably configured (CONTEXT Claude's Discretion). A single static language badge is acceptable if trivially correct; skip CI/coverage badges.
- NO description of `simulateSellForChain` / `simulateSellV3ForChain` as working — they are deliberate broken-by-design stubs per Phase-18 rebuild (RESEARCH §14)
- NO description of Phase 19 anti-rug as implemented — it is not started (RESEARCH §14)
- NO oversell of `contracts/` footprint beyond `HoneypotChecker.sol` + `FakeToken.sol` (RESEARCH §6)
- NO invented features outside RESEARCH §13
- NO marketing/buzzword voice
- NO surfacing of internal phase numbering as primary content (mention v6.17 milestone status and Phase 18/19/20/21 by name only as needed; do not surface plan IDs / wave numbers / `.planning/` artifacts beyond what readers need to understand WIP status)

Length targets per section (soft guidance, total ≈500–800 lines):
- Overview + Status snapshot: ~30 lines combined
- Key Features: ~80–110 lines (grouped bullets, dense)
- Technical Highlights: ~40–60 lines
- Architecture Overview: ~60–90 lines
- Tech Stack: ~50–70 lines
- Feature Deep Dive: ~150–220 lines (largest section)
- Data & Domain Model: ~50–80 lines
- Chain & DEX Support: ~25–40 lines (incl. small table if used)
- Security & Reliability: ~40–60 lines
- In-Progress Work: ~25–40 lines
- Project Structure: ~30–50 lines
- Tests & CI: ~30–45 lines
- Running the Bot: ~20–35 lines
- Conclusion: ~10–20 lines

Final sanity-check pass before writing (Work-Process step 4 in the brief):
- Every Key Features bullet and every Feature Deep Dive paragraph must be back-able by a specific file path or table row in RESEARCH §17.
- Every WIP claim must match the wording shape in RESEARCH §14 (contract audited + CI gate live; runtime wire-up pending plan 18-09; Phase 19 not started; Phase 20 partial; Phase 21 deferred).
- Every chain claim must match RESEARCH §7 (4 chains: ETH/BSC/Base/Arb; MEV strategy assignments; DEX coverage).
- Every test/CI claim must match RESEARCH §11–§12 (43 *.test.ts files = 29 unit + 13 integration + 1 fork; 70% coverage; 3 tsc --noEmit; .todo ban; Slither + Mythril on contracts/**).

After writing the file, commit it atomically with:
- File added: `README.md`
- Commit message: `docs(readme): rewrite README.md — engineer-first deep-dive grounded in 260518-jsr research`
  - Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

Use `rtk` prefix on the git commands per the user's global CLAUDE.md (RTK is available — the prefix is harmless when no filter exists). The MEMORY note that `rtk not installed` is acknowledged; if `rtk` errors as not-found, fall back to plain `git`. The user's global CLAUDE.md is explicit that even in chained commands RTK should be tried first.
  </action>

  <verify>
    <automated>
      cd /c/Users/jackc/WebstormProjects/crypto-snipe-bot &&
      test -f README.md &&
      LINES=$(wc -l < README.md) &&
      echo "README.md line count: $LINES" &&
      test "$LINES" -ge 500 && test "$LINES" -le 850 &&
      # Forbidden visual aids: no fenced code blocks, no Mermaid, no obvious ASCII box-drawing chars
      ! grep -nE '^```' README.md &&
      ! grep -niE 'mermaid' README.md &&
      ! grep -nE '[─━│┃┌┐└┘├┤┬┴┼╔╗╚╝]' README.md &&
      # Forbidden content: must NOT describe broken sims as working, must NOT promise Phase 19 as done
      ! grep -niE 'simulateSellForChain[^[:alnum:]_].*(works?|working|reliable|hard.?gate)' README.md &&
      ! grep -niE 'simulateSellV3ForChain[^[:alnum:]_].*(works?|working|reliable)' README.md &&
      # Required core claims (case-insensitive substring presence — verifier-level, not prose-grading):
      grep -qi 'crypto snipe bot' README.md &&
      grep -qi 'multi-chain' README.md &&
      grep -qiE 'ethereum|\beth\b' README.md &&
      grep -qiE '\bbsc\b|binance' README.md &&
      grep -qiE '\bbase\b' README.md &&
      grep -qiE 'arbitrum|\barb\b' README.md &&
      grep -qi 'flashbots' README.md &&
      grep -qi 'bloxroute' README.md &&
      grep -qi 'honeypotchecker' README.md &&
      grep -qi 'slither' README.md &&
      grep -qi 'mythril' README.md &&
      grep -qi 'vitest' README.md &&
      grep -qi 'sqlite' README.md &&
      grep -qi 'wal' README.md &&
      grep -qi 'exit engine' README.md &&
      grep -qi 'trailing stop' README.md &&
      grep -qi 'partial sell' README.md &&
      grep -qi 'risk' README.md &&
      grep -qi 'mev' README.md &&
      grep -qi 'telegram' README.md &&
      grep -qi 'dashboard' README.md &&
      grep -qi 'react' README.md &&
      grep -qi 'express' README.md &&
      grep -qi 'websocket' README.md &&
      grep -qi 'ts-node src/bot.ts' README.md &&
      # WIP must be marked explicitly (per CONTEXT D-WIP)
      grep -qiE 'wip|in progress|in.flight|pending' README.md &&
      # Git: commit must exist on HEAD touching README.md
      git log -1 --name-only --pretty=format: HEAD | grep -q '^README\.md$' &&
      echo "PASS"
    </automated>
  </verify>

  <done>
- `C:/Users/jackc/WebstormProjects/crypto-snipe-bot/README.md` exists, is between 500 and 850 lines inclusive, and contains the section ordering specified above.
- File contains zero fenced code blocks, zero Mermaid blocks, and zero ASCII box-drawing characters.
- All required content claims listed in `must_haves.truths` are present (verifier substring-checks them; reviewer reads them in prose).
- The Phase-18 honeypot rebuild is described truthfully: contract audited (Slither + Mythril clean), deploy pipeline + CI gate shipped, runtime wire-up at `src/bot.ts:229` explicitly marked `**Status:** In Progress` (or equivalent inline WIP tag) and pointing at the pending plan 18-09 work.
- Phase 19 anti-rug is mentioned as **not started**; Phase 20 ops-live as **partial**; Phase 21 EXIT-LIVE items as **deferred live-runtime validation**.
- The README is committed to git on the current branch in a single commit whose message starts with `docs(readme):` and whose only changed file is `README.md`.
- `git log -1 --name-only` confirms `README.md` is the only file in the latest commit.
  </done>
</task>

</tasks>

<verification>
The single task in this plan is self-verifying via the `<automated>` block above. The structural verifier (run after this plan executes) will additionally:

1. Cross-check the file against `must_haves.truths` substrings.
2. Confirm `must_haves.artifacts[0].path` exists with line count in `[500, 850]`.
3. Confirm `must_haves.key_links` patterns are referenced somewhere in the README (engineer-prose mentions of `src/bot.ts`, `chainRegistry`, `exitEngine`, `tokenSafety`, `honeypot`, `HoneypotChecker.sol`, `test.yml` or `workflows`, and `package.json`/`TypeScript`/`ethers`/`better-sqlite3`/`express`).
4. Confirm the forbidden patterns (fenced code blocks, Mermaid, ASCII box-drawing, "working sell-sim" claims, Phase-19-as-done claims) are absent.
5. Confirm the latest git commit touches **only** `README.md`.

If any of these checks fail, the verifier will return a gap report and this plan will be re-entered in gap-closure mode.
</verification>

<success_criteria>
- [ ] `README.md` exists at repo root with line count in `[500, 850]`
- [ ] Section ordering matches the engineer-first structure above
- [ ] Tone is engineer-first, technically dense, polished, no marketing voice
- [ ] Every shipped-feature claim is back-able by RESEARCH §17 file paths
- [ ] WIP features are marked inline with explicit status tags
- [ ] No fenced code blocks, no Mermaid, no ASCII diagrams
- [ ] No clone/fork boilerplate section
- [ ] No description of `simulateSellForChain` / `simulateSellV3ForChain` as working
- [ ] No description of Phase 19 anti-rug as implemented
- [ ] Stack section matches `package.json` + `dashboard/package.json` versions cited in RESEARCH §2
- [ ] All 4 chains (ETH/BSC/Base/Arb) and all 3 MEV strategies (Flashbots/bloXroute/passthrough) are documented
- [ ] HoneypotChecker.sol described as **audited** (Slither + Mythril clean) with **runtime wire-up WIP**
- [ ] Vitest 3-project structure, 43 test files, 70% coverage, CI invariants (`.todo` ban + 3× `tsc --noEmit` + Slither + Mythril on contracts/**) all mentioned
- [ ] Single atomic commit on current branch, message prefixed `docs(readme):`, only `README.md` changed
</success_criteria>

<output>
This is a quick-task plan (mode: quick-full). No SUMMARY.md is required; the executor commits `README.md` and the verifier runs against this plan's `must_haves`.
</output>
