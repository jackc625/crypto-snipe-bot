// test/rails/probes/dotenvProbe.ts
// Phase 22 plan 22-10 Task 2 - SAFE-02 src layer, D-01: loads one dotenv site in a real child
// process and prints how many .env read attempts the setup layer recorded. Run ONLY as a
// railed child through test/rails/spawnRailedChild.ts.
//
//   npx ts-node test/rails/probes/dotenvProbe.ts config|notifier
//
// The last stdout line is a bare number, the env-read-blocked entries in this process's
// ledger. It is printed only after the target really loaded, so a probe that cannot load its
// target can never read as "0 attempts" (review concern L239@e2e59f6):
//   exit 2  unknown target argument
//   exit 3  the setup-layer .env block is not installed in this process
//   exit 4  the target module failed to import (including a wrong path)
//   exit 5  this process's ledger holds no worker-start entry (the count would be meaningless)

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../core.cjs') as {
    railsStatus(): { envBlockInstalled: boolean };
    readLedger(): Array<{ kind: string }>;
};

// test/rails/probes/ is three levels below the repo root.
const TARGETS: Record<string, () => unknown> = {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    config: () => require('../../../src/config'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifier: () => require('../../../src/utils/notifier'),
};

function main(): void {
    const target = process.argv[2];
    const load = Object.prototype.hasOwnProperty.call(TARGETS, target) ? TARGETS[target] : undefined;
    if (!load) {
        process.stderr.write(`dotenvProbe: unknown target ${String(target)}\n`);
        process.exit(2);
    }
    if (!core.railsStatus().envBlockInstalled) {
        process.stderr.write('dotenvProbe: the .env block is not installed\n');
        process.exit(3);
    }
    try {
        load();
    } catch (err) {
        process.stderr.write(`dotenvProbe: import of ${target} failed: ${String((err as Error).message)}\n`);
        process.exit(4);
    }
    const ledger = core.readLedger();
    if (!ledger.some((e) => e.kind === 'worker-start')) {
        process.stderr.write('dotenvProbe: this process has no rail ledger entries\n');
        process.exit(5);
    }
    process.stdout.write(`\n${ledger.filter((e) => e.kind === 'env-read-blocked').length}\n`);
}

main();
