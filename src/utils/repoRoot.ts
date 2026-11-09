// src/utils/repoRoot.ts
//
// Phase 22 plan 22-09 (SAFE-05, AC-25 / E18, CONTEXT "Repo-root anchoring").
//
// The DB path must not depend on the directory the process happens to start from. This
// finds the repository root by walking up from the calling module's own file to the nearest
// package.json named crypto-snipe-bot. It uses no __dirname-relative depth and no runtime git,
// so it keeps working when src/ is restructured.

import fs from 'fs';
import path from 'path';

const REPO_PACKAGE_NAME = 'crypto-snipe-bot';

export function findRepoRoot(fromFile: string = __filename): string {
    let dir = path.dirname(path.resolve(fromFile));
    for (;;) {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg)) {
            let name: unknown;
            try {
                name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
            } catch {
                name = undefined; // an unreadable package.json is not the one we want; keep walking
            }
            if (name === REPO_PACKAGE_NAME) return fs.realpathSync.native(dir);
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`findRepoRoot: no package.json named ${REPO_PACKAGE_NAME} above ${fromFile}`);
        }
        dir = parent;
    }
}
