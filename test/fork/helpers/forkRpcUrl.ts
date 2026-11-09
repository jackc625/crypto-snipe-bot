// test/fork/helpers/forkRpcUrl.ts
// Phase 22 plan 22-11 — SAFE-02 / AC-17: the one place that reads ETH_FORK_RPC_URL.
//
// The fork project gets its RPC URL from the operator's shell and from nowhere else: there is
// no fallback to any other variable and no .env read. A missing value is a clear error naming
// the variable, so a fork run can never silently pick up a value the rails replace with a
// sentinel.
//
// This module runs in two places:
//   (a) the Vitest main process (test/fork/setup.ts globalSetup), which sees the real shell; and
//   (b) fork workers, where the fork-mode rails (test/rails/setup-fork.cjs, FORK_SHELL_KEYS in
//       test/rails/core.cjs, 22-05) re-apply the shell value after the env scrub.
//
// Pure test infrastructure (D-ROLLBACK): this file adds no env var and no bypass. It has no
// runtime imports so test/unit/rails/forkRpcSource.test.ts can exercise it without Hardhat.

/** The fork RPC URL from the shell, or a clear error naming ETH_FORK_RPC_URL. */
export function resolveForkRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
    const url = env.ETH_FORK_RPC_URL;
    if (typeof url === 'string' && url !== '') return url;
    throw new Error(
        'ETH_FORK_RPC_URL is required for fork tests and is read from the shell only (never from .env). ' +
            'Run them as: ETH_FORK_RPC_URL=<archive RPC url> npm run test:fork',
    );
}

/** True when resolveForkRpcUrl(env) would return a URL. */
export function hasForkRpcUrl(env: NodeJS.ProcessEnv = process.env): boolean {
    const url = env.ETH_FORK_RPC_URL;
    return typeof url === 'string' && url !== '';
}
