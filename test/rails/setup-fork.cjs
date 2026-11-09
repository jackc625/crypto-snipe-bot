'use strict';
// test/rails/setup-fork.cjs
// Phase 22 plan 22-05 Task 2 — SAFE-02 rails, Vitest `setupFiles` entry for the fork project.
// Fork rails (SPEC R4): env scrub + test/.env.test sentinels with exactly FORK_SHELL_KEYS
// (ETH_FORK_RPC_URL, ALLOW_REAL_MAINNET) re-applied from the first capture of the inherited
// shell env (AC-17, D-GATE-BOTH-LAYERS), .env block, data/ fs block, DB tripwire and the
// Telegram host deny. The general non-loopback network deny is NOT installed here: fork tests
// reach the local Hardhat node, which forks from the operator's RPC. No env var selects the
// mode or widens the key list (NAC-05); a later full install can only upgrade (strictest wins).
require('./core.cjs').installRails({ mode: 'fork' });
