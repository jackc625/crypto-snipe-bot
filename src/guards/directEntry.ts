// src/guards/directEntry.ts
//
// Phase 22 plan 22-13: SAFE-04 / D-07. src/bot.ts must only be started through src/main.ts,
// which takes the single-instance lock first.
//
// This module must stay the FIRST statement of src/bot.ts. TypeScript compiles imports to
// require calls in source order, and every later import of bot.ts has side effects when it
// loads (config, the DB open and migration, the notifier). A refusal placed anywhere else runs
// after them. Importing bot.ts from anything else (src/main.ts, a test, a script) is not a
// direct start and is left alone.
//
// It reads no environment variable and imports only fs and path, so it can run before
// anything else exists. Phase 26's ESM conversion must re-check this guard: require.main does
// not exist in ESM.

import fs from 'fs';
import path from 'path';

const REFUSAL =
    'Refusing to start: start the bot via src/main.ts (npx ts-node src/main.ts or npm start), ' +
    'which takes the single-instance process lock first (SAFE-04).\n';

function canonical(file: string): string {
    let resolved = path.resolve(file);
    try {
        const real = fs.realpathSync.native(resolved);
        if (typeof real === 'string') resolved = real;
    } catch {
        // A file that cannot be resolved still compares by its full path.
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** True when mainFile (the process entry point) is the same file as entryFile. */
export function isDirectEntry(entryFile: string, mainFile: string | undefined): boolean {
    if (mainFile === undefined) return false;
    return canonical(entryFile) === canonical(mainFile);
}

/** Exits the process with code 1 when entryFile is the file the process was started from. */
export function refuseIfDirectEntry(entryFile: string): void {
    if (isDirectEntry(entryFile, require.main?.filename)) {
        process.stderr.write(REFUSAL);
        process.exit(1);
    }
}

// src/bot.ts under ts-node, the compiled bot.js under tsconfig.bot.json.
refuseIfDirectEntry(path.join(__dirname, '..', `bot${path.extname(__filename)}`));
