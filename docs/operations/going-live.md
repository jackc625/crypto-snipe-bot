# Going Live

First-time setup for live trading on Ethereum mainnet. Default config runs only `eth`; see §Adding chains for BSC/Base/Arbitrum.

There is no simulation/paper mode — once the bot starts with a mainnet RPC and a funded wallet, it executes real transactions. The only built-in guardrail is a chain-ID mismatch check at startup.

---

## 1. Trading wallet

The current `.env` has the publicly-known Hardhat test key (`ac0974be…`). Replace it before anything else.

Generate a fresh wallet:
```bash
node -e "const w = require('ethers').Wallet.createRandom(); console.log('addr:', w.address); console.log('key: ', w.privateKey)"
```

Set in `.env`:
```
PRIVATE_KEY=<new_private_key>
```

Fund the address. With current defaults (`ETH_MAX_CAPITAL=1.0`, `ETH_SNIPE_AMOUNT=0.01`) you'd want ~1.1 ETH including gas. For a first run, lower these — see §6.

---

## 2. RPC endpoints

Sign up for Alchemy (or Infura/QuickNode), create a mainnet app, copy both URLs:
```
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<KEY>
ETH_WS_URL=wss://eth-mainnet.g.alchemy.com/v2/<KEY>
```

WebSocket is required for fast pair-creation discovery. Without it the bot falls back to 2s HTTP polling and misses most launches.

Verify the endpoint returns chainId 1. The curl uses `$ETH_RPC_URL` from your shell, so you have to load `.env` into the shell first (it's not enough for the value to be in the file):

```bash
set -a; source .env; set +a

curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  "$ETH_RPC_URL"
```

Expected: `{"jsonrpc":"2.0","id":1,"result":"0x1"}` (`0x1` = mainnet).

---

## 3. Flashbots auth key

A separate signing key used only to track bundle reputation. Doesn't need ETH.

```bash
node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
```

```
FLASHBOTS_AUTH_KEY=<generated_key>
```

---

## 4. Telegram (required — bot exits at startup without all five vars)

### Outbound bot (alerts)
1. DM `@BotFather` → `/newbot` → save token
2. Get your chat ID: message `@userinfobot`, or `/start` your new bot and visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to grab `result[].message.chat.id`

```
TELEGRAM_BOT_TOKEN=<from_botfather>
TELEGRAM_CHAT_ID=<your_chat_id>
```

### Inbound listener (alpha drops via MTProto user account)
1. Register an app at https://my.telegram.org/apps → save API ID and hash
2. Generate a session string with this one-shot script:

```ts
// gen-session.ts
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

(async () => {
  const client = new TelegramClient(
    new StringSession(''),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH!,
    { connectionRetries: 5 },
  );
  await client.start({
    phoneNumber: () => ask('phone: '),
    password:    () => ask('2FA password (empty if none): '),
    phoneCode:   () => ask('code from Telegram: '),
    onError:     (e) => console.error(e),
  });
  console.log('SESSION:', (client.session as StringSession).save());
  process.exit(0);
})();
```

Run once, copy the printed string, delete the script:
```bash
TELEGRAM_API_ID=<id> TELEGRAM_API_HASH=<hash> npx ts-node gen-session.ts
```

```
TELEGRAM_API_ID=<id>
TELEGRAM_API_HASH=<hash>
TELEGRAM_SESSION=<long_string>
```

Strongly recommend whitelisting — empty values mean any contract address in any chat your account is in gets routed into the snipe pipeline:
```
TELEGRAM_ALLOWED_SENDERS=<comma_separated_user_ids>
TELEGRAM_ALLOWED_CHANNELS=<comma_separated_chat_ids>
```

Verify outbound works (same env-sourcing requirement as §2 — `$TELEGRAM_BOT_TOKEN` and `$TELEGRAM_CHAT_ID` need to be in the shell, not just `.env`):

```bash
set -a; source .env; set +a

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}&text=preflight_ok"
```

Expected: `{"ok":true,...}` and a `preflight_ok` message in your Telegram chat.

---

## 5. Dashboard API key

Replace the weak default (`password`):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
```
DASHBOARD_API_KEY=<32_byte_hex>
```

Default bind is `127.0.0.1:8080` — local only. Do not set `DASHBOARD_HOST=0.0.0.0` without TLS in front.

---

## 6. Risk params — tune DOWN for the first run

```
ETH_SNIPE_AMOUNT=0.002
ETH_MAX_CAPITAL=0.02
MAX_POSITION_SIZE=0.002
MAX_OPEN_POSITIONS=3
MAX_TOTAL_EXPOSURE=0.02
SNIPE_COOLDOWN_MS=60000
PARTIAL_SELL_TARGETS=2x:50,5x:25
```

---

## 7. Pre-flight checks

```bash
npm install
npm run build
npm run test:unit
```

Wallet balance — derives the address from `PRIVATE_KEY` automatically (avoids the manual-substitution footgun, since ethers will try to ENS-resolve a literal placeholder string):

```bash
node -e "
require('dotenv').config();
const { JsonRpcProvider, formatEther, Wallet } = require('ethers');
const addr = new Wallet(process.env.PRIVATE_KEY).address;
new JsonRpcProvider(process.env.ETH_RPC_URL)
  .getBalance(addr)
  .then(b => console.log(addr, '=', formatEther(b), 'ETH'));
"
```

If this is the first time you're running the bot in this clone, clear any stale dev seed data from the SQLite DB before §8:

```bash
rm -rf data/
```

The bot recreates the directory and runs all schema migrations from scratch on next start. Skip this if you've already run the bot and have real exit-engine state to preserve.

---

## 8. Go live

```bash
npx ts-node src/bot.ts
```

Confirm in the first 60 seconds of logs:
- `Chain registry built` with `enabledChains: ["eth"]`
- chainId 1 matched (no `FATAL` log)
- `Flashbots health check passed`
- `Listening for PairCreated events via WebSocket` per DEX
- `Telegram listener connected and listening`
- A startup alert in your Telegram chat

Health check from another shell:
```bash
curl http://127.0.0.1:8080/health
```

---

## 9. Kill switch

Pause new entries without disturbing existing exit monitors:
```bash
# log in to get session cookie
curl -c cookies.txt -X POST http://127.0.0.1:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"apiKey\":\"$DASHBOARD_API_KEY\"}"

# pause
curl -b cookies.txt -X POST http://127.0.0.1:8080/api/controls/pause-snipes
```

Or `Ctrl+C` the process — graceful shutdown persists exit state and exits within 5s.

---

## Adding chains

Set `ENABLED_CHAINS=eth,bsc,base,arb` (any subset). The same `PRIVATE_KEY` signs across all chains, so fund the same address on each.

| Chain | Required env | Notes |
|---|---|---|
| `bsc` | `BSC_RPC_URL`, `BSC_WS_URL`, `BLOXROUTE_AUTH_HEADER` | bloXroute is a paid subscription at https://bloxroute.com. Bot exits `FATAL` if BSC enabled without it. |
| `base` | `BASE_RPC_URL` (+ optional `BASE_WS_URL`) | No MEV service — native private mempool. |
| `arb` | `ARB_RPC_URL` (+ optional `ARB_WS_URL`) | No MEV service — FCFS ordering. |

---

## Operational notes

- `./data/bot.db` (SQLite, WAL) holds trade and exit-state history. Delete the directory to start fresh; otherwise migrations run additively.
- Safety provider APIs (honeypot.is, GoPlus, Unicrypt, Mudra) are keyless and free. They do have rate limits — when an API fails the bot defaults to blocking the snipe.
- Logs are pino JSON. Set `LOG_LEVEL=debug` for verbose troubleshooting; `info` for normal operation.
- The bot does not check wallet balance at startup. If unfunded, it starts cleanly and just fails every snipe with insufficient-funds errors.

---

## Preflight failure modes

The bot calls `preflight()` at startup (Phase 20 / Plan 20-04, wired at `src/bot.ts` line 889) which runs seven per-chain checks plus a chain-agnostic cross-env validator and a one-shot stale-position scanner. Any FATAL exits the process with a pino fatal log + Telegram alert pointing back at this doc. The remediation steps below mirror the order checks fire in `src/preflight.ts`.

You can preview every check **without** starting the bot:
```bash
npm run preflight              # human-readable per-chain summary
npm run preflight -- --json    # machine-readable
```
Exit code 0 = all-pass; 1 = at least one FATAL; 2 = uncaught throw.

### checkRpcChainId — chain ID mismatch
- **Triggers FATAL when:** `provider.getNetwork().chainId` does not equal the configured chain's expected ID (ETH=1, BSC=56, Base=8453, Arb=42161).
- **Why:** RPC pointed at the wrong chain — typically because `ETH_RPC_URL` is a testnet/staging endpoint. Signing a buy against a wrong chain would either revert or, worse, execute on the wrong chain entirely.
- **Remediation:**
  1. Verify `<CHAIN>_RPC_URL` points to mainnet (not Sepolia/Goerli/testnet).
  2. Re-read `.env` and confirm the chain you intended is what the URL references (e.g., `eth-mainnet.g.alchemy.com`, not `eth-sepolia`).
  3. `curl` the endpoint with `eth_chainId` (see §2 above) — expected `0x1` for ETH.
- **Example pino log:**
  `{"level":50,"chain":"eth","check":"rpc-chainid","reason":"chainId mismatch","expected":1,"got":11155111,"remediation":"docs/operations/going-live.md"}`

### checkRpcBlockAge — RPC tip is stale
- **Triggers FATAL when:** `now - block.timestamp > chain.blockAgeToleranceSec` per-chain ceiling (ETH 300s, BSC 60s, Base 30s, Arb 30s; override via `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC`).
- **Why:** Lagged RPCs cost money — a stale tip means MEV protection (Flashbots, bloXroute) sees the same lag and your snipe transactions go out at the wrong block-base-fee curve, miss the inclusion window, or worse get included against stale state.
- **Remediation:**
  1. Switch to a different RPC endpoint (Alchemy/Infura/QuickNode — see §2). Free-tier sometimes lags during peak load; paid tiers don't.
  2. If the lag is widespread (provider-side outage), wait for the provider to sync.
  3. As a temporary loosener while you swap providers: `ETH_BLOCK_AGE_TOLERANCE_SEC=600` (be careful — going far above the default trades correctness for liveness).
- **Example pino log:**
  `{"level":50,"chain":"eth","check":"rpc-block-age","reason":"block too old","blockAgeSec":750,"toleranceSec":300,"remediation":"docs/operations/going-live.md"}`

### checkWalletBalance — wallet undercut
- **Triggers FATAL when:** `provider.getBalance(wallet.address) < snipeAmount × MAX_OPEN_POSITIONS + <CHAIN>_GAS_BUFFER` (the **operational floor**, not the `<CHAIN>_MAX_CAPITAL` deployment ceiling — per Phase 20 D-BALANCE-FLOOR).
- **Why:** This is the floor a single fully-loaded operational cycle needs. Below it, the bot can't simultaneously hold `MAX_OPEN_POSITIONS` snipes plus reserve enough native units to cover gas on exit. Falling below mid-run is so bad that the bot also runs this check every `MID_RUN_CHECK_INTERVAL_SEC` (default 300s = 5 min) and flips the global pause flag on undercut (see Pause/resume CLI section below).
- **Formula:**
  ```
  floor = parseEther(<CHAIN>_SNIPE_AMOUNT) × MAX_OPEN_POSITIONS + parseEther(<CHAIN>_GAS_BUFFER)
  ```
- **Worked example — current 0.0124 ETH funding on mainnet:**
  With `ETH_SNIPE_AMOUNT=0.003`, `MAX_OPEN_POSITIONS=1`, `ETH_GAS_BUFFER=0.005`:
  ```
  floor = 0.003 × 1 + 0.005 = 0.008 ETH
  ```
  Funded balance 0.0124 ETH > 0.008 ETH ⇒ passes.
  If you bump `MAX_OPEN_POSITIONS=3` without funding more:
  ```
  floor = 0.003 × 3 + 0.005 = 0.014 ETH > 0.0124 ETH ⇒ FATAL.
  ```
- **Remediation:**
  1. Refund the wallet to at least `floor` (use the §7 wallet-balance snippet to check current balance).
  2. **OR** lower `MAX_OPEN_POSITIONS` to fit your funded balance.
  3. **OR** lower `<CHAIN>_SNIPE_AMOUNT`. Do NOT loosen `<CHAIN>_GAS_BUFFER` — that's the reserve for **exit-side** gas, not entry.
- **Example pino log:**
  `{"level":50,"chain":"eth","check":"wallet-balance","reason":"undercut","balanceEth":"0.0040","floorEth":"0.0080","remediation":"docs/operations/going-live.md"}`

### checkMevHealth — Flashbots / bloXroute auth failure
- **Triggers FATAL when:** the chain's MEV strategy `healthCheck()` returns false.
  - **Flashbots (ETH):** `FLASHBOTS_AUTH_KEY` missing, malformed, or unparseable as an ethers private key.
  - **bloXroute (BSC):** `BLOXROUTE_AUTH_HEADER` missing OR `api.blxrbdn.com` returned 401/403 on the benign-call probe.
- **Why:** Without valid MEV auth, snipes go out on the public mempool where they get sandwiched or front-run.
- **Remediation:**
  1. Re-read §3 for the Flashbots key generator; paste into `FLASHBOTS_AUTH_KEY`.
  2. For BSC, log into bloXroute (`bloxroute.com`) and copy your auth header verbatim into `BLOXROUTE_AUTH_HEADER` (paid subscription required).
  3. **Base/Arb** are passthrough chains (native private mempool) — `checkMevHealth` short-circuits to PASS without a network call. If you see a Base/Arb FATAL here, it's a configuration bug — check `src/chainRegistry.ts` `mevStrategy` field for that chain.
- **Example pino log:**
  `{"level":50,"chain":"eth","check":"mev-health","reason":"flashbots auth invalid","remediation":"docs/operations/going-live.md"}`

### checkHoneypotCheckerCode — HoneypotChecker contract not deployed
- **Triggers FATAL when:** `provider.getCode(<CHAIN>_HONEYPOT_CHECKER_ADDRESS)` returns `'0x'` (no bytecode at that address).
- **Why:** The Phase 18 honeypot pipeline (`src/utils/honeypot/checkerContract.ts`) calls a deployed `HoneypotChecker.sol` via `provider.call({ to, data, value })` and decodes the revert payload. If the address has no code, every honeypot check returns `verdict: 'unknown'` and every buy gets blocked silently — defeats the whole pre-buy gate.
- **Remediation:**
  1. Verify `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` is set in `.env`.
  2. Confirm the address exists on the target chain: `cast code <CHAIN>_HONEYPOT_CHECKER_ADDRESS --rpc-url $<CHAIN>_RPC_URL` should be non-empty.
  3. If not deployed, run the Phase 18 deployer:
     ```bash
     npx ts-node scripts/deploy-honeypot-checker.ts <chain>   # chain = eth | bsc | base | arb
     ```
     Then paste the printed address into `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` and restart preflight.
- **As of 2026-05-24:** ETH ships with `0x8243dBeA5caD296B9e72a6ed557D7E0fEBee13eD` already deployed and committed in `src/chainRegistry.ts`. BSC/Base/Arb deploys are pending Plan 18-08 — preflight on those chains will FATAL until the deploy lands.
- **Example pino log:**
  `{"level":50,"chain":"eth","check":"honeypot-checker-code","reason":"no bytecode at deployedAddress","address":"0x...","remediation":"docs/operations/going-live.md"}`

### validateCrossEnvRules — internally inconsistent env
- **Triggers FATAL when:** any of four cross-variable rules fires:
  - `MEV_STRATEGY=flashbots` is selected on a chain but `FLASHBOTS_AUTH_KEY` is unset.
  - `bsc` is enabled in `ENABLED_CHAINS` but `BLOXROUTE_AUTH_HEADER` is unset.
  - One of `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` is set but not all five Telegram envs (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` + the three above) — partial Telegram config is worse than none.
  - A chain in `ENABLED_CHAINS` is missing its `<CHAIN>_RPC_URL`.
- **Why:** These combinations would otherwise fail loudly mid-run with a confusing stack trace ("Cannot read auth-key of undefined"). Cross-env catches them at boot.
- **Remediation:** The pino fatal log names the exact rule and the missing env. Fix that env (see §3, §4, §2 above for the canonical sources) and re-run preflight.
- **Example pino log:**
  `{"level":50,"check":"cross-env-rule","reason":"MEV_STRATEGY=flashbots requires FLASHBOTS_AUTH_KEY","missing":["FLASHBOTS_AUTH_KEY"],"remediation":"docs/operations/going-live.md"}`

### checkAntiRugLiveGate — anti-rug live-mode flipped too early
- **Triggers FATAL when:** `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` AND (`chain_state.antirug_dry_run_started IS NULL` OR `now - antirug_dry_run_started < 7 × 86400`).
- **Why:** Phase 19 anti-rug ships with a hard 7-day dry-run floor before live exits are allowed (D-LIVE-GATE). The check enforces the floor at boot — operators cannot flip live without the dry-run telemetry behind them.
- **Remediation:**
  1. Confirm the bot has been running with dry-run telemetry: `SELECT chain, antirug_dry_run_started FROM chain_state` against `data/bot.db` should show timestamps ≥ 7 days old per chain.
  2. If a chain has no timestamp, anti-rug hasn't started there yet — start the bot in dry-run (`<CHAIN>_ANTIRUG_LIVE_EXECUTE=false` or omitted) and wait 7 days while reviewing every trigger with 0 confirmed false positives.
  3. Once the floor is met, flip `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` (exact lowercase) and restart the bot.
- **See also:** `docs/operations/anti-rug-rollout.md` for the full live-mode graduation procedure (env reference, FP review, CB reset).
- **Example pino log:**
  `{"level":50,"chain":"eth","check":"antirug-live-gate","reason":"dry-run floor not met","daysRemaining":4,"remediation":"docs/operations/anti-rug-rollout.md"}`

---

## Pause/resume CLI usage

The bot keeps a single-row `pause_state` table in `data/bot.db` that gates the V2 + V3 buy path at three checkpoints (`src/bot.ts` CP1/CP2/CP3 per Phase 20 D-KILLSWITCH-CP1/2/3). When the global pause flag is set:

- New buys are blocked at CP1 (pre-bundle-build) and CP2 (pre-submit) for both V2 and V3.
- CP3 (post-submit, audit-only) logs but lets in-flight bundles finish — **pause never panic-sells** (D-KILLSWITCH-CP3).
- **Existing exit monitors keep running** (D-PAUSE-SHAPE). Pause stops *entries*; positions you already hold continue to be sold by the unified exit engine.

### When to pause
- You see anomaly in a running snipe and want to stop opening new positions while you investigate.
- You're about to rotate Flashbots/bloXroute auth keys.
- You're about to deploy a new HoneypotChecker per Phase 18 Plan 18-08 and want to ensure no in-flight checks during the deploy.
- Wallet balance dropped — but the mid-run check (see §Mid-run wallet undercut recovery below) **already auto-pauses** for this case; you typically don't need to do it manually.

### When NOT to pause
- **Emergency-sell scenarios.** Pause does not sell anything. If you need to dump every position right now, use either the dashboard's Emergency Sell All button or `POST /api/controls/emergency-sell` directly.
- **Single-position sell.** Use the dashboard per-position Force Sell button or `POST /api/controls/force-sell/:tradeId`. Pausing the whole bot for one bad position is the wrong tool.

### CLI usage
```bash
# Pause new entries with a reason; reason is sanitized + clamped to 120 chars (T-20 mitigation)
npm run pause -- --reason "manual stop for investigation"

# Resume — no reason needed
npm run resume
```

Both commands do a two-step axios flow: `POST /api/auth/login` (apiKey from `DASHBOARD_API_KEY`) → cookie forward → `POST /api/controls/pause` (or `/resume`). Exit code 0 = success; 1 = missing `DASHBOARD_API_KEY` or non-200 from either endpoint; 2 = uncaught throw.

The `DASHBOARD_API_KEY` is **never** logged by either script (Phase 20 T-20-05 mitigation, enforced by static-grep tests).

### Dashboard usage
The dashboard shows a **full-bleed red banner** (D-PAUSE-UI) at the top of every page when paused:
```
BOT PAUSED
Paused by: cli       Reason: manual stop for investigation       At: 2026-05-24T14:32:18Z
                                                          [ Resume ]
```
Click **Resume** to clear the flag — same effect as `npm run resume`. The banner subscribes to the `pause_state_change` WebSocket event so it flips within one round-trip of any pause/resume action from any source (dashboard, CLI, bot mid-run undercut).

### Restart survival
The pause flag is persisted in SQLite, so a SIGKILL + restart with `paused=1` honors the pause at CP1 (per D-PAUSED-RESTART, verified by Plan 20-04 integration test). The operator sees the dashboard banner immediately on restart and can manage open positions via Force Sell / Emergency Sell. The pause stays in place until explicitly cleared.

### Audit trail
Every pause/resume writes a row to `pause_state`:
```bash
sqlite3 data/bot.db "SELECT paused, paused_at, paused_by, reason FROM pause_state;"
```
`paused_by` is one of:
- `'dashboard'` — clicked the dashboard Resume button or paused via the SPA
- `'cli'` — `npm run pause` / `npm run resume`
- `'preflight'` — auto-pause from the mid-run wallet undercut detector
- `'manual'` — direct `POST /api/controls/pause` without source attribution (e.g., curl)

Do **NOT** edit the `pause_state` table directly via `sqlite3` CLI — it bypasses the WebSocket broadcast (dashboard won't update) and skips the structured pino log line (no audit trail).

---

## Mid-run wallet undercut recovery

The bot runs `checkWalletBalance` on a setInterval every `MID_RUN_CHECK_INTERVAL_SEC` seconds (default 300s = 5 min) per Phase 20 Plan 20-04. If any chain's balance drops below the operational floor (`snipeAmount × MAX_OPEN_POSITIONS + <CHAIN>_GAS_BUFFER` per D-BALANCE-FLOOR), the bot automatically:

1. Flips the global pause flag with `paused_by='preflight'`.
2. Broadcasts `pause_state_change { paused: true, pausedBy: 'preflight', reason: 'wallet undercut: ...' }` over the dashboard WebSocket — the red banner appears within ~1 round-trip.
3. Emits a pino fatal log:
   `{"level":60,"chain":"eth","check":"wallet-balance","reason":"undercut","balanceEth":"...","floorEth":"...","remediation":"docs/operations/going-live.md"}`
4. Sends a Telegram alert: `*BOT PAUSED* (wallet undercut) -- balanceEth=... floorEth=...`
5. **Continues running exit monitors.** No new buys, but existing positions still get partial-sold / trailing-stopped / time-urgency-sold per the unified exit engine.

The setInterval is **idempotent** (T-20-04 guard at `src/bot.ts`): a sustained undercut produces exactly ONE alert per pause-cycle, not N alerts per N tick intervals.

### Recovery steps
1. **Refund the wallet** to at least the operational floor. Use the §7 wallet-balance snippet to check current balance.
2. **Verify the new balance:**
   ```bash
   # Foundry's cast
   cast balance <wallet_address> --rpc-url $ETH_RPC_URL --ether

   # Or via the dashboard wallet card
   ```
3. **Resume:**
   ```bash
   npm run resume
   ```
   or click **Resume** on the dashboard banner.
4. **Verify resumption:**
   - Dashboard banner disappears.
   - `sqlite3 data/bot.db "SELECT paused FROM pause_state;"` returns `0`.
   - A pino info line `{"op":"pause.cleared","clearedBy":"cli"}` (or `"dashboard"`) appears in the bot logs.
   - The next mid-run tick (within ≤ `MID_RUN_CHECK_INTERVAL_SEC`) does NOT re-pause (proves the refund actually cleared the floor).

### Anti-patterns
- **Do NOT** manually `UPDATE pause_state SET paused=0` via `sqlite3` — bypasses the WS broadcast (dashboard stays red) and the audit trail.
- **Do NOT** loosen `<CHAIN>_GAS_BUFFER` to "fit" a low balance — that buffer is the exit-side gas reserve, and shrinking it means a high-volatility sell can run out of gas mid-bundle and partially execute.
- **Do NOT** disable the mid-run setInterval. There is no env to disable it; if you find one, you've broken `src/bot.ts` (the plan's D-ROLLBACK invariant forbids a bypass).

---

## Anti-rug live-gate flip procedure

Phase 19 anti-rug runtime monitoring ships with a **7-day dry-run floor** before per-chain live exits are allowed (D-LIVE-GATE). The full operator-facing procedure lives in **`docs/operations/anti-rug-rollout.md`** — that doc is the authoritative source. Summary:

### Pre-requisites (both must be met)
1. **7-day calendar floor:** `chain_state.antirug_dry_run_started` for the target chain is at least 7 days (`7 × 86400 = 604800` seconds) in the past. This is recorded automatically by `src/anti-rug/detector.ts` on the first `startChainAntiRugListener` call per chain (Phase 20 D-ANTIRUG-LIVE-GATE-CODE source).
2. **Zero confirmed false positives:** during the 7-day window, every `[DRY-RUN] Anti-rug would-have-sold` event in Telegram + the dashboard Frontrun Outcome Distribution panel has been reviewed by the operator with disposition "true positive" or "intentional locker — add to ALLOWLIST_EXTRA." See `anti-rug-rollout.md` §"Live-mode graduation review" for the FP-review workflow.

### Action
Once both pre-requisites are met:
1. Edit `.env`: set `<CHAIN>_ANTIRUG_LIVE_EXECUTE=true` (exact lowercase per `D-LIVE-PER-CHAIN`; `TRUE`, `1`, `yes` all stay dry-run).
2. Restart the bot: `Ctrl+C` + `npx ts-node src/bot.ts`.
3. `checkAntiRugLiveGate` runs as part of `preflight()` at boot. If the 7-day floor is not met or the timestamp is missing, **the bot FATALs and refuses to start** — no silent partial live-mode possible.
4. Once started, the dashboard's Anti-Rug Monitor tile shows the chain status as **LIVE** (no longer DRY-RUN).

### Related docs
- **`docs/operations/anti-rug-rollout.md`** — env-var reference (11 envs × 4 chains = 44 envs), bot restart procedure, dry-run + live verification, CB reset, troubleshooting, Wave-1 V3 follow-up tracker.
- **`docs/operations/anti-rug-tuning.md`** — threshold-tuning protocol (5 categories of tunable parameters, 4-tier review cadence, `.env` + git audit trail).

---

## RPC/MEV/checker validation troubleshooting

### RPC issues

**Symptom: `checkRpcChainId` FATAL with `expected:1, got:11155111`**
Your `ETH_RPC_URL` points to Sepolia (chainId 11155111) instead of mainnet (chainId 1). Common when you copy-paste an Alchemy URL from the wrong app. Fix: regenerate the mainnet URL from the Alchemy dashboard's "Networks → Ethereum Mainnet" app.

**Symptom: `checkRpcBlockAge` FATAL with `blockAgeSec=750, toleranceSec=300`**
The RPC tip is 12.5 minutes stale on a 300s tolerance. Two causes:
1. **Free-tier rate-limiting** under load — Alchemy / Infura / QuickNode free tier sometimes lags during peak load. Switch to a paid plan or rotate to a different provider.
2. **Provider-side outage** — check the provider's status page. If widespread, the bot should not start until the provider syncs.

**Per-chain block-age tolerance defaults** (override via `<CHAIN>_BLOCK_AGE_TOLERANCE_SEC`):
| Chain | Block time | Default tolerance | Rationale |
|---|---|---|---|
| ETH | 12s | 300s (~25 blocks) | Generous because Flashbots private inclusion has natural lag |
| BSC | 3s | 60s (~20 blocks) | Tighter because BSC blocks fast and stale tip means slow bloXroute routing |
| Base | 2s | 30s (~15 blocks) | Tightest; native private mempool is robust but stale tip is unusable |
| Arb | 0.25s | 30s (~120 blocks) | Matches Base; FCFS means tip is everything |

Going far above the defaults trades correctness for liveness. Don't loosen unless you've already swapped RPC endpoints and confirmed the lag is real.

### MEV issues

**Symptom: `checkMevHealth` FATAL on ETH with `reason: flashbots auth invalid`**
Either `FLASHBOTS_AUTH_KEY` is missing or it's not a valid ethers private key (wrong length, malformed hex, etc.). Generate a fresh one per §3 and paste verbatim.

**Symptom: `checkMevHealth` FATAL on BSC with `reason: bloxroute 401` or `403`**
`BLOXROUTE_AUTH_HEADER` is wrong (typo, expired, or your subscription lapsed). Log into bloxroute.com → API → copy the header verbatim into `.env`. Note: bloXroute is a **paid subscription** — the bot FATALs at boot if BSC is enabled without it (this is intentional fail-loud).

**Symptom: `checkMevHealth` weirdly fails on Base or Arb**
Base and Arb default to **passthrough** strategy (native private mempool — Flashbots-equivalent without the relay). `checkMevHealth` short-circuits to PASS without a network call for passthrough chains. If you see a FATAL here, `src/chainRegistry.ts` `mevStrategy` for that chain has been misconfigured to non-passthrough. Check the field in chainRegistry.ts and confirm it reads `'passthrough'` for Base/Arb.

### HoneypotChecker issues

**Symptom: `checkHoneypotCheckerCode` FATAL with `getCode='0x'`**
The address in `<CHAIN>_HONEYPOT_CHECKER_ADDRESS` has no bytecode on the target chain. Two causes:
1. **Contract not yet deployed** — run the Phase 18 deployer:
   ```bash
   npx ts-node scripts/deploy-honeypot-checker.ts <chain>   # eth | bsc | base | arb
   ```
   Then paste the printed address into `<CHAIN>_HONEYPOT_CHECKER_ADDRESS`.
2. **Wrong network** — the address is deployed on mainnet but your `<CHAIN>_RPC_URL` is testnet (or vice versa). Re-verify §2.

**Symptom: snipes are getting `verdict: 'unknown'` for every token on BSC/Base/Arb**
The HoneypotChecker has not been deployed on those chains yet (pending Plan 18-08). The dispatcher returns `'unknown'` (fail-closed → block) when `deployedAddress` is set but `getCode` is empty — that's by design. Until 18-08 ships, only ETH has live honeypot detection.

### Stale-data warnings (not a FATAL)

`checkStaleData()` runs once at startup and scans `trades` for positions whose `timestamp` is older than `STALE_WARN_SEC` (default 120s = 2 min) and `STALE_ERROR_SEC` (default 600s = 10 min) per Phase 20 D-STALE-THRESHOLDS. Log fires are the observable — the bot does NOT FATAL on stale data.

A pino log line like:
```
{"level":40,"op":"stale-data.warn","tradeId":42,"ageSec":180,"chain":"eth","token":"0x..."}
```
means trade 42 is 3 minutes old without progress. Common causes:
- **RPC was down** while the position was open — the exit engine couldn't poll prices. Check RPC health (above).
- **Exit engine wedged** on a partial-sell mutex deadlock. Restart the bot — `resumeMultiChainMonitoring` will reattach a fresh exit monitor.
- **Partial-sell tier hit but sell failed silently** — check `trades` for any `partial_sell` rows after the buy; if none, the sell failed and the position is stuck.

If you see `level:50` (`op: 'stale-data.error'`) for the same trade ID, that's a sustained 10+ minute outage and requires operator intervention. Run Force Sell from the dashboard, then investigate the root cause before restarting.

The defaults `STALE_WARN_SEC=120` / `STALE_ERROR_SEC=600` were chosen per Plan 20-01 D-STALE-THRESHOLDS — the original "2× / 4× poll interval" (10s / 20s) was too noisy because normal exit-engine poll cycles produced false warnings every 5 seconds. The current defaults are operationally meaningful — they catch real RPC outages and wedged-exit-engine cases without crying wolf.

---

*Last updated: 2026-05-24 (Phase 20 ship — runbook moved from repo root to docs/operations/; 5 D-OPERATOR-HANDOFF sections appended per Plan 20-07)*
*See also: `docs/operations/anti-rug-rollout.md`, `docs/operations/anti-rug-tuning.md`, `.planning/phases/20-going-live-ops-hardening/20-RESEARCH.md`*
