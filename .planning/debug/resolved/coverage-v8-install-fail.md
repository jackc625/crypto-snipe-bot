---
status: resolved
trigger: "Investigate why @vitest/coverage-v8 fails to install"
created: 2026-03-30T16:34:00Z
updated: 2026-03-30T17:00:00Z
---

## Current Focus

hypothesis: Missing .npmrc with legacy-peer-deps=true causes npm install to fail due to ERESOLVE, preventing @vitest/coverage-v8 from being installed
test: Confirmed via npm install --dry-run showing ERESOLVE error
expecting: Adding .npmrc with legacy-peer-deps=true will resolve the install
next_action: Return diagnosis

## Symptoms

expected: npm install installs all dependencies including @vitest/coverage-v8
actual: npm install fails with ERESOLVE; @flashbots/ethers-provider-bundle@1.0.0 requires peer ethers@6.7.1 but project uses ethers@6.16.0
errors: "Could not resolve dependency: peer ethers@6.7.1 from @flashbots/ethers-provider-bundle@1.0.0"
reproduction: Run `npm install` (without --legacy-peer-deps) in project root
started: Since @flashbots/ethers-provider-bundle was added with ethers pinned at 6.16.0

## Eliminated

(none needed - root cause confirmed on first hypothesis)

## Evidence

- timestamp: 2026-03-30T16:34:30Z
  checked: .npmrc existence
  found: No .npmrc file exists in project root
  implication: No project-level npm configuration to handle peer dep conflicts

- timestamp: 2026-03-30T16:34:30Z
  checked: .github/workflows/test.yml line 17
  found: CI uses `npm ci --legacy-peer-deps` explicitly
  implication: CI knows about the conflict and works around it; local dev has no equivalent

- timestamp: 2026-03-30T16:34:30Z
  checked: package-lock.json for @vitest/coverage-v8
  found: Present in lockfile at line 2775 (resolved, with integrity hash)
  implication: Lockfile was generated with --legacy-peer-deps at some point; package IS in the lockfile

- timestamp: 2026-03-30T16:34:30Z
  checked: node_modules/@vitest/coverage-v8
  found: Directory does not exist
  implication: Last npm install was run without --legacy-peer-deps and failed before installing this package

- timestamp: 2026-03-30T16:34:30Z
  checked: package-lock.json for @flashbots/ethers-provider-bundle peer deps
  found: peerDependencies declares exactly `"ethers": "6.7.1"` (exact version, not range)
  implication: The flashbots package pins an exact peer version that's 9 minor versions behind project's ethers@6.16.0

- timestamp: 2026-03-30T16:35:00Z
  checked: npm install --dry-run
  found: ERESOLVE error confirming peer ethers@6.7.1 vs ethers@6.16.0 conflict
  implication: Root cause confirmed - bare npm install cannot resolve the tree

## Resolution

root_cause: The project has no .npmrc file. The CI pipeline works around the peer dependency conflict by passing `--legacy-peer-deps` explicitly to `npm ci`, but local `npm install` has no equivalent configuration. The conflict originates from @flashbots/ethers-provider-bundle@1.0.0 which declares an exact peer dependency on ethers@6.7.1, while the project uses ethers@6.16.0.
fix: Create .npmrc with `legacy-peer-deps=true` so that both local installs and CI installs handle the conflict consistently.
verification: pending
files_changed: []
