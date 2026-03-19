---
status: resolved
trigger: "Diagnose UAT gaps: CONFIG.network hardcoded to sepolia, no .env.example file"
created: 2026-03-19T20:30:00Z
updated: 2026-03-19T21:30:00Z
---

## Current Focus

hypothesis: Two separate omissions from phase-01 implementation - network not wired to env var, .env.example never created
test: Read config.ts, flashbots.ts, telegramListener.ts, grep for NETWORK env usage
expecting: Confirm no NETWORK env var is read anywhere, confirm no .env.example exists
next_action: return diagnosis (find_root_cause_only mode)

## Symptoms

expected: CONFIG.network driven by NETWORK env var; .env.example documents all env vars
actual: CONFIG.network hardcoded to "sepolia" on line 51; no .env.example file exists
errors: N/A (design omissions, not runtime errors)
reproduction: Read src/config.ts line 51; run `ls .env.example` (file not found)
started: Always been this way - phase-01 implementation did not address these

## Eliminated

(none - root cause identified on first pass)

## Evidence

- timestamp: 2026-03-19T20:31:00Z
  checked: src/config.ts line 51
  found: "network: 'sepolia' as SupportedNetwork" - literal string, no env var reference
  implication: Network is hardcoded; switching requires source edit

- timestamp: 2026-03-19T20:31:00Z
  checked: Grep for "NETWORK" across entire codebase
  found: Zero references to process.env.NETWORK anywhere in src/
  implication: No code was ever written to read a NETWORK env var

- timestamp: 2026-03-19T20:31:00Z
  checked: REQUIRED_ENV_VARS array in config.ts (lines 13-24)
  found: Array lists 8 required + 2 optional vars. NETWORK is NOT in the array.
  implication: Even the validation framework was never extended for NETWORK

- timestamp: 2026-03-19T20:32:00Z
  checked: src/utils/flashbots.ts FLASHBOTS_RELAYS map
  found: Map has entries for "sepolia" and "mainnet", keyed by CONFIG.network
  implication: Downstream code already supports multi-network - only CONFIG.network input is missing

- timestamp: 2026-03-19T20:32:00Z
  checked: rpc object in config.ts (lines 43-46)
  found: "sepolia" key uses ALCHEMY_URL env var; "bsc" key is hardcoded URL. No "mainnet" entry.
  implication: rpc map also needs a mainnet entry to fully support network switching

- timestamp: 2026-03-19T20:33:00Z
  checked: SupportedNetwork type (line 48)
  found: Type is derived as keyof typeof rpc, so it's "sepolia" | "bsc"
  implication: Adding mainnet to rpc map would automatically extend the type

- timestamp: 2026-03-19T20:33:00Z
  checked: Glob for .env.example, .env.sample, .env.template
  found: None exist. Only .env (gitignored) exists.
  implication: No env documentation file was ever created

- timestamp: 2026-03-19T20:34:00Z
  checked: All process.env references in src/
  found: 10 distinct env vars used across config.ts, telegramListener.ts, notifier.ts, testAlert.ts, txManager.ts
  implication: Full env var inventory is available from REQUIRED_ENV_VARS + NETWORK (to be added)

## Resolution

root_cause: |
  GAP 1 (CONFIG.network hardcoded): The rpc map and FLASHBOTS_RELAYS were built to support
  multiple networks, but the final wiring step was never completed. CONFIG.network on line 51
  is a string literal "sepolia" instead of reading from process.env.NETWORK with a default
  fallback. Additionally, NETWORK was never added to the REQUIRED_ENV_VARS validation array.
  The rpc map itself also lacks a "mainnet" entry, so even if NETWORK were read, selecting
  "mainnet" would fail at the rpc level (though it would succeed at the Flashbots relay level).

  GAP 2 (No .env.example): The REQUIRED_ENV_VARS array in config.ts serves as an internal
  registry of env vars with descriptions, but this information was never externalized into a
  .env.example file. Phase-01 added two new optional vars (TELEGRAM_ALLOWED_SENDERS,
  TELEGRAM_ALLOWED_CHANNELS) which are undiscoverable without reading source code.

fix: ""
verification: ""
files_changed: []
