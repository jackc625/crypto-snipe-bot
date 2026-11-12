// test/realpath/triage/AUD-SCRIPTS-001.test.ts
// Phase 23 plan 23-13 Task 2 (AUDIT-02, D-07, D-08): AUD-SCRIPTS-001 (RC-27), proven statically.
//
// The finding: the two legacy scripts addLiquidity and deploySepoliaTest import compiled Hardhat
// artifacts of Solidity sources that are no longer in the repository (UniswapV2Router02,
// UniswapV2Factory and interfaces/IWETH; only contracts/FakeToken.sol and the honeypot checker
// remain), so neither script can load: module resolution fails before main() runs and nothing is
// signed. Behind the broken imports both would sign with the bot wallet key on ALCHEMY_URL (the
// finding's other sub-claims, read from code; not re-asserted here).
//
// How (the static route RESEARCH names for this entry): the directory walk of scripts/ goes to
// ts.createProgram as its root names (fixtures/scriptsStatic.ts, options mirroring tsconfig.json
// with resolveJsonModule), and each script's relative module specifiers are resolved with the
// compiler's own module resolution. No file is named as a path the test reads: script names come
// only from the walk (the form plan 23-19's AC-37 gate accepts).
//   Correct:  no script has a relative import that does not resolve ([]).
//   Observed: ['addLiquidity', 'deploySepoliaTest'], the two legacy scripts.
// The detail check after the marker: every unresolved specifier is a compiled artifact under
// ../artifacts/contracts/, and each of the two scripts misses the three artifacts whose Solidity
// source does not exist (so no compile can produce them). FakeToken's artifact may or may not be
// present on a given machine (artifacts/ is untracked; this checkout has a stale FakeToken.json),
// which changes no row.
//
// Phase 24/29 reading (card SCRIPTS-03, HYG-03): deleting both scripts, the recommendation, flips the
// claim to "looks fixed" (shown by a mutation that removed both files, restored from git). This entry
// also feeds the signing-census exceptions in plan 23-17 (the legacy scripts hold 10 of the 12
// script exceptions listed under AUD-SCRIPTS-002); card SCRIPTS-01 stays open (operator, Phase 22).
//
// Nothing here runs a script, loads its code, or mocks anything.

import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../rails/spawnRailedChild';
import { knownBug } from '../harness/knownBug';
import { buildScriptsProgram, relativeImportSpecifiers, scriptFiles, scriptName, unresolvedRelativeImports } from './fixtures/scriptsStatic';

// Building the program type-loads src/ through the scripts' imports. Measured on Node 22: about 2 s
// alone (times under the full run are in the plan summary); the realpath default limit is 15 s.
const PROGRAM_TIMEOUT_MS = 60_000;

// The three artifacts whose Solidity source is gone, so no compile can produce them.
const NO_SOURCE_ARTIFACTS = ['IWETH.json', 'UniswapV2Factory.json', 'UniswapV2Router02.json'];

describe('AUD-SCRIPTS-001: the two legacy scripts import compiled artifacts that do not exist, so neither can load', () => {
    it('legacy-scripts-unresolved-artifact-imports: the compiler cannot resolve relative imports of addLiquidity and deploySepoliaTest', { timeout: PROGRAM_TIMEOUT_MS }, (ctx) => {
        const run = buildScriptsProgram(REPO_ROOT);
        // The scan itself works (an empty or broken scan must never read as fixed): the walk found
        // scripts, and the compiler resolves relative imports that do exist.
        expect(run.rootNames.length, 'the walk found scripts').toBeGreaterThan(0);
        const allRelative = scriptFiles(run).flatMap((sf) => relativeImportSpecifiers(sf).map((spec) => ({ script: scriptName(sf.fileName), spec })));
        const unresolved = unresolvedRelativeImports(run);
        expect(allRelative.length - unresolved.length, 'some relative imports resolve').toBeGreaterThan(0);

        const actual = [...new Set(unresolved.map((u) => u.script))].sort();
        knownBug(ctx, 'AUD-SCRIPTS-001', {
            claim: 'legacy-scripts-unresolved-artifact-imports',
            correct: [] as string[],
            observed: ['addLiquidity', 'deploySepoliaTest'],
            actual,
            expectedPlain: 'Every script in scripts/ can load: each of its imports resolves.',
            actualPlain: 'addLiquidity and deploySepoliaTest import compiled contract files that no longer exist, so neither can even start.',
        });

        // Detail: only compiled artifacts are missing, and each script misses the three with no source.
        expect(unresolved.filter((u) => !u.specifier.startsWith('../artifacts/contracts/'))).toEqual([]);
        for (const script of actual) {
            const missing = unresolved.filter((u) => u.script === script).map((u) => u.specifier.split('/').pop()!);
            expect(missing, script).toEqual(expect.arrayContaining(NO_SOURCE_ARTIFACTS));
        }
    });
});
