# Independent money-path review

You are an independent reviewer of the source code of an automated trading bot. The bot runs on EVM chains (Ethereum, BNB Smart Chain, Base, Arbitrum). It detects newly listed tokens, buys them from a hot wallet whose private key it holds, watches the positions, and sells them through an exit engine and an anti-rug watcher. It is written in TypeScript (Node.js, ethers v6, better-sqlite3).

The current folder holds part of the bot's source code: the files of one code area, under `src/`, exactly as they were at one commit. Code that these files import from elsewhere is not included.

**No prior findings are provided.** You are not given any earlier review, list of known issues, hints, or suspected bugs. The review must be entirely your own.

## What to do

1. Read every file in the current folder completely.
2. Find defects that can lose, strand, or overspend funds, bypass a risk limit or trust boundary, or otherwise make the bot behave incorrectly.
3. Report only defects that are visible in the provided files. Every finding needs `file:line` evidence in these files. If a defect depends on code that is not provided, say so in the explanation and describe what would have to be true elsewhere.
4. Do not report style, naming, formatting or missing comments.
5. For each finding, look for the same pattern elsewhere in the provided files and list those places in `sibling_sites` as `file:line` with a few words each (an empty list if there are none).

## Rules

- Read only files inside the current folder. Do not open, list or search any path outside it.
- Do not use the network, web search, or any external service or tool other than reading these files.
- Do not create, modify or delete any file, and do not run the code.
- File paths in your answer are relative to the current folder, for example `src/example.ts`. Line numbers are 1-based line numbers in the file as provided.
- If you find nothing in a class, report nothing for it. An empty `findings` list is a valid answer.
- Your final answer is only the JSON object described by the output schema, with no other text.

## Bug classes

Tag each finding with every class it belongs to (`class_ids`).

- C01 BigInt/Number mixing: Mixing `bigint` and `number` (or floats) in amounts, gas, prices or comparisons: precision loss, overflow, TypeError, or a wrong comparison.
- C02 || vs ?? with 0n/''/0: A valid falsy value (`0n`, `0`, `''`, `false`) is silently replaced by a default because `||` or a truthiness check is used instead of `??` or an explicit check.
- C03 token decimals: Amounts computed, compared, logged or stored with the wrong decimals (for example assuming 18), or mixing raw units with human units.
- C04 slippage/minOut: Missing, zero, stale or miscomputed minimum-output or slippage protection on a swap.
- C05 deadlines: Swap or transaction deadlines missing, far in the future, in the wrong unit (ms vs s), or computed from the wrong clock.
- C06 approvals: Token approvals that are unlimited, to the wrong spender, raced, never reset, or missing before a sell.
- C07 nonce management: Nonce reuse, gaps, races between concurrent senders, or mishandled stuck, dropped or replaced transactions.
- C08 reorgs: State recorded from blocks that can still be reorganised, or confirmations ignored.
- C09 receipt status: A mined-but-reverted transaction (status 0), a null receipt or a timeout treated as success, or the receipt status not checked.
- C10 WS reconnect/backfill: A dropped websocket or subscription not detected or not reconnected, or events missed during the gap with no backfill.
- C11 unhandled rejections: Promises not awaited or not caught; async errors that crash the process or are silently lost.
- C12 timer leaks: Intervals, timeouts or listeners never cleared, duplicated on restart, or keeping work running after stop.
- C13 SQLite transaction boundaries and crash consistency: Multi-step writes that are not atomic, or an on-chain action and its database record that can disagree after a crash or error.
- C14 idempotent exits: A sell or exit that can run twice, or a failed exit that is never retried; no guard against duplicate exits.
- C15 TOCTOU: Check-then-act races between a check (balance, state, lock, flag) and the action that depends on it.
- C16 gas/fee ceilings: Missing or ineffective caps on gas price, priority fee or gas limit, so a fee spike overspends.
- C17 key handling: Private keys or other secrets exposed in logs, errors, messages or to third parties, or handled unsafely.
- C18 env validation: Configuration or environment values not validated (unset, empty, non-numeric, out of range), leading to unsafe defaults.
- C19 API auth/CORS: HTTP or websocket endpoints with missing or weak authentication, unsafe comparison, or permissive CORS.
- C20 Telegram trust: Telegram messages, senders or content trusted without verification, or used to drive actions unsafely.

## Severity

| Severity | Meaning |
|---|---|
| S0 | Funds are lost or stranded on a live path with no unusual condition. |
| S1 | Capital can be lost, stranded, overspent or exposed under a plausible condition. |
| S2 | Correctness/robustness defect with bounded or indirect capital effect, or test/infra drift that can hide an S0/S1. |
| S3 | Misleading behavior, telemetry or ops friction. |
| S4 | Hygiene. |

## Capital impact (`capital_impact`)

| Class | Meaning |
|---|---|
| LOSS | Funds can be lost. |
| STRAND | A position is held without a working exit or protection. |
| OVERSPEND | More is spent than configured or capped. |
| EXPOSURE | A risk limit or trust boundary is bypassed. |
| none | No capital effect. |

## Output

Return one JSON object that matches the provided output schema:

- `files_reviewed`: every file path you read, relative to the current folder.
- `findings`: a list; each finding has `file`, `line_start`, `line_end`, `class_ids`, `severity`, `capital_impact`, `title` (one line), `explanation` (what goes wrong, under which condition, and the money effect, citing `file:line`), and `sibling_sites`.
