'use strict';
// test/rails/probes/moduleScopeDb.cjs
// Phase 22 plan 22-08 Task 1 — SAFE-02 AC-14 probe: a child that points DB_PATH at the live
// DB and imports src/utils/db at MODULE SCOPE must be stopped by the rails DB tripwire
// (RAIL_DB_TRIPWIRE) before better-sqlite3 opens the file. Run ONLY as a railed child
// through test/rails/spawnRailedChild.ts.
//
// Fail-safe order: if the DB tripwire is not installed in this process, exit 3 at once,
// BEFORE DB_PATH is set or src/ is loaded, so a child without rails can never reach the
// live data/ folder.

const core = require('../core.cjs');

if (!core.railsStatus().dbWrapperInstalled) {
    process.stderr.write('moduleScopeDb: rails DB tripwire not installed — refusing to import src/utils/db\n');
    process.exit(3);
}

process.env.DB_PATH = './data/bot.db';
require('ts-node/register/transpile-only');
require('../../../src/utils/db');

// Reaching this line means the import did NOT trip: report it loudly.
process.stderr.write('moduleScopeDb: src/utils/db imported WITHOUT tripping the rails\n');
process.exit(4);
