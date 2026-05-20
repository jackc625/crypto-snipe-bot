---
phase: 18-honeypot-detection-rebuild
plan: 07
subsystem: honeypot-deploy
tags: [honeypot, mainnet-deploy, hardhat-ignition, etherscan-verify, chainRegistry, env-overlay, sepolia-rehearsal, etherscan-v2]

# Dependency graph
requires:
  - phase: 18-honeypot-detection-rebuild
    provides: plan 18-05 — HONEY-02 Slither + Mythril audit clearance (D-STOP-THE-LINE: 0 escalations, "NO escalation; deploy gate cleared for HONEY-03")
  - phase: 18-honeypot-detection-rebuild
    provides: plan 18-06 — chainRegistry honeypotChecker overlay + hardhat per-chain deploy networks + scripts/deploy-honeypot-checker.ts CLI
provides:
  - HONEY-03 closes: live, Etherscan-verified (V2 + V3) HoneypotChecker on Ethereum mainnet at 0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD
  - ChainTemplate.defaultHoneypotCheckerAddress field — canonical source-of-truth literal per iter-2 Blocker #3 (env overlay remains as operator hot-patch)
  - test/integration/honeypotDeploy.eth.test.ts — bytecode-at-address + Ignition-artifact cross-check (T-18-25 drift mitigation)
  - .env.example Phase 18 deploy section (11+ env vars covering all chains + deprecated v2-obsolete *SCAN keys)
  - HONEY-03 Deploy Artifacts section appended to v6.17-honeypot-checker-audit.md
  - hardhat.config.ts wiring corrections for v2 Etherscan API + dedicated SEPOLIA_RPC_URL env var
  - Sepolia rehearsal pattern + artifacts (rehearsal-then-mainnet flow documented for plans 18-08)
affects: [18-08, 18-09, 18-10]

# Tech tracking
tech-stack:
  added:
    - "test/integration/honeypotDeploy.eth.test.ts (HONEY-03 live-chain integration test; vitest + ethers JsonRpcProvider)"
    - "SEPOLIA_RPC_URL env var (hardhat.config.ts sepolia network entry now reads from this dedicated var)"
  removed:
    - "hardhat.config.ts Etherscan v1 per-network apiKey object (replaced with v2 single-key string)"
    - "hardhat.config.ts sepolia entry's reliance on ALCHEMY_URL + PRIVATE_KEY (now uses SEPOLIA_RPC_URL + DEPLOY_PRIVATE_KEY for capability-split alignment with mainnet)"
  patterns:
    - "Sepolia rehearsal precedes mainnet (testnet deploy + verify FIRST, then mainnet using identical commands swapping --network sepolia → --network mainnet). Same DEPLOY_PRIVATE_KEY across both chains; address determinism from (deployer, nonce=0) yields the same deployed address on both."
    - "Canonical-default-in-source-file + env-overlay-as-override (iter-2 Blocker #3): the contract address is committed as a TypeScript string literal in CHAIN_TEMPLATES; the env var overrides for operator hot-patching without redeploy + recompile. `git diff` shows the literal address being added — single-line audit trail."
    - "Ignition deployment artifact as ground-truth (ignition/deployments/chain-<id>/deployed_addresses.json) cross-checked against the chainRegistry literal in the integration test; address drift between source and artifact is a build-time failure."
    - "Etherscan API v2 single-key pattern: hardhat-verify@2.1+ uses one ETHERSCAN_API_KEY across mainnet/BSC/Base/Arb/Sepolia; the v1 per-network apiKey object is deprecated (Etherscan sunset 2025-05-31)."

key-files:
  created:
    - "test/integration/honeypotDeploy.eth.test.ts (50 LOC; 2 it.skipIf cases — bytecode-at-address + Ignition-artifact cross-check)"
    - ".planning/milestones/v6.17-honeypot-checker-audit.md §HONEY-03 Deploy Artifacts (appended; deploy artifacts + 4 documented deviations)"
    - "ignition/deployments/chain-1/* (Hardhat Ignition mainnet deploy artifacts — deployed_addresses.json, journal.jsonl, build-info)"
    - "ignition/deployments/chain-11155111/* (Sepolia rehearsal artifacts — preserved for audit trail)"
  modified:
    - "src/chainRegistry.ts (ChainTemplate.defaultHoneypotCheckerAddress field + 4 template entries — eth populated with literal 0x8243…13eD, bsc/base/arb null; buildChainRegistry() env-overlay falls back to template default; CHAIN_TEMPLATES promoted to named export so integration tests can read literal without buildChainRegistry side-effects)"
    - "hardhat.config.ts (sepolia entry: ALCHEMY_URL+PRIVATE_KEY → SEPOLIA_RPC_URL+DEPLOY_PRIVATE_KEY+chainId 11155111; etherscan.apiKey: v1 per-network object → v2 single ETHERSCAN_API_KEY string)"
    - ".env.example (Phase 18 deploy section appended: 4× HONEYPOT_CHECKER_ADDRESS slots + DEPLOY_PRIVATE_KEY + 4× explorer API keys (1 active + 3 deprecated v2-obsolete) + SEPOLIA_RPC_URL + 8× MAX_*_TAX_BPS slots)"

key-decisions:
  - "Same DEPLOY_PRIVATE_KEY for Sepolia rehearsal + mainnet deploy. Trade-off: the deploy wallet's address appears in faucet logs (Alchemy Sepolia faucet) — minor information exposure for a stateless immutable contract that anyone can deploy. Benefit: identical deterministic address on Sepolia and mainnet (nonce=0 derivation), single key to manage during the deploy window, and the wallet is rotated out of .env immediately after mainnet verify per D-DEPLOY-KEY. Two-wallet alternative considered and rejected as marginal-value overhead for a first-time deploy."
  - "ChainTemplate.defaultHoneypotCheckerAddress added (not honeypotChecker.deployedAddress as plan 18-07 instructed). Plan 18-06 shipped the env-overlay logic without a template-level slot; iter-2 Blocker #3 implemented by adding a new field to ChainTemplate + falling back in buildChainRegistry overlay. Preserves env-overlay-as-override semantics and keeps the integration test simple (read CHAIN_TEMPLATES.eth.defaultHoneypotCheckerAddress directly). Documented as deviation #3 in audit doc."
  - "Etherscan API v2 migration (deviation #1). hardhat-verify@2.1+ rejects the v1 per-network apiKey object; a single ETHERSCAN_API_KEY covers all 5 chains the project deploys to (mainnet + Sepolia + BSC + Base + Arb). The plan's .env.example spec asked for separate BSCSCAN/BASESCAN/ARBISCAN keys — kept in .env.example with explicit [DEPRECATED] markers so plan 18-08 reviewers see the migration note rather than mistakenly trying to set them."
  - "SEPOLIA_RPC_URL introduced (deviation #2). The original sepolia network entry in hardhat.config.ts read from ALCHEMY_URL — a footgun because ALCHEMY_URL elsewhere in the codebase is the legacy mainnet RPC (bot fallback + fork test base). A real Alchemy mainnet key in ALCHEMY_URL would have caused `--network sepolia` to connect to mainnet. Renamed to dedicated SEPOLIA_RPC_URL; ALCHEMY_URL retains existing roles."
  - "Address stored in EIP-55 checksummed form (0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD), not lowercase. Plan instructed lowercase per ethers conventions but the existing CHAIN_TEMPLATES uses checksummed form for all DEX routers/factories — consistency with the rest of the file outweighs the plan's instruction. Hardhat Ignition emits checksummed form, so it's also the literal as-deployed value."
  - "Mainnet + Sepolia deployed addresses are identical (0x8243…13eD on both). Expected and not a bug — contract addresses are deterministic from (deployer_address, deployer_nonce); a fresh deploy wallet (nonce=0) deploying identical bytecode produces the same address. The chain ID + EVM state are still independent; only the address-derivation result is the same."

# Threat coverage delta
threats-mitigated:
  - T-18-24 (Elevation of Privilege via compromised DEPLOY_PRIVATE_KEY): capability-split enforced (deploy wallet separate from bot wallet); D-CONTRACT-IMMUTABLE prevents upgrade-path abuse; operator visually audited Etherscan source (V2 + V3) before chainRegistry literal commit.
  - T-18-25 (Address pasted into .env differs from actual deploy): integration test cross-checks ChainRegistry literal against ignition/deployments/chain-1/deployed_addresses.json — drift fails the test at build time.
  - T-18-25b (Audit-gate rubber-stamp): Task 1 STEP 1 automated grep precheck gated the operator instructions exposure — operator could not bypass via "approved" without the audit doc literally containing the clearance phrase.
  - T-18-26 (Bypassed Etherscan verification): visually verified on Sepolia first (rehearsal), then on mainnet; both V2 + V3 entry points visible in the verified source.
  - T-18-27b (chainRegistry literal differs from Etherscan-verified bytes): single-line addition in src/chainRegistry.ts — git diff is human-auditable; integration test enforces correspondence.

# Follow-ups for downstream plans
followups:
  - "Plan 18-08 (BSC/Base/Arb batch): observation window opens 2026-05-19; earliest 18-08 start is 2026-05-22 per D-CONTRACT-ROLLOUT. Same DEPLOY_PRIVATE_KEY works on all 3 chains (each nonce 0 derives same address from this wallet) — but per BSC/Base/Arb their explorers may not unify under Etherscan v2 the same way mainnet does; plan 18-08 should verify hardhat-verify@2.1 supports them under ETHERSCAN_API_KEY before committing the deploy."
  - "Plan 18-08 should commit literal address into CHAIN_TEMPLATES.{bsc,base,arb}.defaultHoneypotCheckerAddress (3 separate commits per iter-2 Blocker #3) using the same pattern as this plan."
  - "Plan 18-08 .env.example update should NOT add new *SCAN_API_KEY slots — they're already marked [DEPRECATED] in the file per this plan; instead document any per-chain explorer differences if v2 unification breaks for any chain."
  - "Plan 18-09 (autonomous Option-D wrapper): consumes ctx.chain.honeypotChecker.deployedAddress — now resolves to the ETH literal via template default when env unset. Plan 18-09 fork tests need ETH_FORK_RPC_URL set to a mainnet RPC where the deployed contract exists (immediately runnable since deploy is live at 2026-05-19)."

# Verify gate (plan 18-07 Task 3)
verify-gate:
  - "npx tsc --noEmit: PASS (exit 0)"
  - "test/integration/honeypotDeploy.eth.test.ts: PASS (2/2 tests; ran live against mainnet via ETH_RPC_URL)"
  - "test file contains HONEY-03 + provider.getCode + skipIf: PASS"
  - ".env.example contains ETH_HONEYPOT_CHECKER_ADDRESS + DEPLOY_PRIVATE_KEY + ETHERSCAN_API_KEY + ETH_MAX_BUY_TAX_BPS=1000: PASS"
  - "v6.17-honeypot-checker-audit.md contains HONEY-03 Deploy Artifacts + 40-hex address: PASS"
  - "src/chainRegistry.ts CHAIN_TEMPLATES.eth.defaultHoneypotCheckerAddress literal (0x8243…13eD): PASS"
  - "Etherscan visual verify (V2 + V3 functions present): PASS — confirmed by operator at https://etherscan.io/address/0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD#code"
  - "Contract Creator on Etherscan matches deploy wallet 0x54F2…1e1D: PASS — confirmed by operator"
---

# Summary

HONEY-03 ETH mainnet deploy is live. `HoneypotChecker.sol` (V2 + V3 entry points, 362 LOC, immutable, no constructor args) is deployed at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD` on Ethereum mainnet (chainId 1), source-verified on Etherscan, and committed as the canonical literal default in `src/chainRegistry.ts CHAIN_TEMPLATES.eth.defaultHoneypotCheckerAddress` per iter-2 Blocker #3.

## Execution narrative

1. **Audit precheck (Task 1 STEP 1):** `grep` for "NO escalation; deploy gate cleared for HONEY-03" against `.planning/milestones/v6.17-honeypot-checker-audit.md` returned `AUDIT_CLEAR` (plan 18-05's Slither + Mythril determination — 0 escalations, 13/13 medium+ findings dispositioned false-positive against the eth_call + revert-always design). Per iter-2 Blocker #4, the operator instructions were exposed only after this automated check cleared.

2. **Sepolia rehearsal (added by operator decision; not in plan 18-07 scope):** Before any mainnet step, the operator ran the full deploy + Etherscan-verify flow against Sepolia testnet using free faucet ETH. This caught and resolved three tooling issues before real money was at risk:
   - `hardhat.config.ts sepolia` entry was misusing `ALCHEMY_URL` (mainnet variable) — fixed to dedicated `SEPOLIA_RPC_URL`.
   - Etherscan v1 multi-network apiKey object failed verification — migrated to v2 single-string `ETHERSCAN_API_KEY` per hardhat-verify@2.1.
   - TypeScript strict-mode flagged the ts-node one-liner — switched to `node -e` for ad-hoc balance checks.
   Sepolia deploy succeeded at `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`; Sepolia Etherscan-verify confirmed V2 + V3 visible. Rehearsal artifacts preserved in `ignition/deployments/chain-11155111/`.

3. **Mainnet funding (Task 1 STEP 2):** Operator created a fresh deploy wallet (address `0x54F24749cb05c1c81b12C58B3030262725561e1D`, generated locally via `Wallet.createRandom()` ethers v6 idiom). Funded with 0.015 ETH (~$32 at $2,116/ETH) from Coinbase. Capability-split per D-DEPLOY-KEY: this wallet is NOT the bot's `PRIVATE_KEY` and has no production trading authority.

4. **Mainnet deploy (Task 2):** `npx hardhat ignition deploy ignition/modules/HoneypotChecker.ts --network mainnet` succeeded in batch #1 at low mainnet gas (~2 gwei). Deployed-address artifact at `ignition/deployments/chain-1/deployed_addresses.json` records the canonical address.

5. **Mainnet Etherscan-verify (Task 2):** `npx hardhat verify --network mainnet 0x8243…13eD` succeeded; visual confirmation: green "Contract Source Code Verified" badge + V2 + V3 function signatures visible in source + Contract Creator field matches the deploy wallet (capability-separation audit trail).

6. **chainRegistry literal commit + integration test + audit doc + .env.example (Task 3):** As described in `key-files` above.

7. **Deploy-key rotation (post-Task 4 follow-up):** Operator will delete `DEPLOY_PRIVATE_KEY` from `.env` after Task 4 (observation window confirm) — the deploy wallet's job is done; the env var should not sit in the file long-term per D-DEPLOY-KEY.

## What stays open

- **Task 4 — 2-3 day observation window.** Opened 2026-05-19. Earliest plan 18-08 (BSC/Base/Arb batch deploy) start: 2026-05-22. Operator should monitor the deployed contract on Etherscan during the window for any third-party reports or chain-explorer anomalies (none expected — the contract is unused until plan 18-09 wires the bot to it).
- **HONEY-03 row in REQUIREMENTS.md** — to be marked Complete in the final tracking commit at the end of plan 18-07 close-out.
- **`DEPLOY_PRIVATE_KEY` cleanup** — operator-driven; not part of the automated verify gate.

## Live observation checklist (2026-05-19 → 2026-05-22)

- [ ] No chain-explorer alerts on `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD`
- [ ] No inbound calls to the contract (it's unused until plan 18-09; any unexpected call indicates third-party scanning or accidental wiring)
- [ ] `DEPLOY_PRIVATE_KEY` rotated out of `.env` post-deploy (manual operator step)

When all three items hold at 2026-05-22+, plan 18-08 batch deploy may proceed.
