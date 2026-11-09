// test/unit/guards/tsconfigCasing.test.ts
//
// Phase 22 plan 22-12 — SAFE-03 AC-21: every tsconfig refuses an import whose casing differs from
// the file on disk, so a casing alias of a guarded module cannot compile silently.

import { describe, expect, it } from 'vitest';
import * as path from 'path';
import ts from 'typescript';

import { REPO_ROOT } from '../../rails/spawnRailedChild';

describe('forceConsistentCasingInFileNames', () => {
    it.each(['tsconfig.json', 'tsconfig.bot.json', 'dashboard/tsconfig.json'])('%s sets it to true', (rel) => {
        const parsed = ts.readConfigFile(path.join(REPO_ROOT, rel), (p) => ts.sys.readFile(p));
        expect(parsed.error).toBeUndefined();
        expect(parsed.config.compilerOptions.forceConsistentCasingInFileNames).toBe(true);
    });
});
