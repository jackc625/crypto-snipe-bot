// test/rails/probes/tsProbe.ts
// Phase 22 plan 22-08 Task 1 — SAFE-02 probe: proves the NODE_OPTIONS rails preload reaches a
// ts-node process started through `npx --no ts-node` (RESEARCH Pattern 4). Run ONLY as a
// railed child through test/rails/spawnRailedChild.ts. Prints one JSON line.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require('../core.cjs') as { railsStatus(): { installed: boolean; mode: string | null } };

const st = core.railsStatus();
process.stdout.write(JSON.stringify({ tsProbe: true, installed: st.installed, mode: st.mode }) + '\n');
