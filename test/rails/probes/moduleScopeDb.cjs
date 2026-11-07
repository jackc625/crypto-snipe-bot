'use strict';
// test/rails/probes/moduleScopeDb.cjs
// Phase 22 plan 22-08 Task 1 — SAFE-02 AC-14 probe: a child that points DB_PATH at the live
// DB and imports src/utils/db at MODULE SCOPE must be stopped by the rails DB tripwire
// (RAIL_DB_TRIPWIRE) before better-sqlite3 opens the file. Run ONLY as a railed child
// through test/rails/spawnRailedChild.ts.
//
// Fail-safe order (P3): before DB_PATH is set or src/ is loaded, this process proves its own
// DB tripwire and data fs block are LIVE on a temp fake protected root. A status flag alone
// is not enough: a neutralised wrapper can be installed and still pass everything through
// (RED proof 22-08-3). If either check does not trip, exit 3 at once, so a child whose
// rails do not work can never reach the live data/ folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const core = require('../core.cjs');

function refuse(why) {
    process.stderr.write(`moduleScopeDb: ${why} — refusing to import src/utils/db\n`);
    process.exit(3);
}

if (!core.railsStatus().dbWrapperInstalled) refuse('rails DB tripwire not installed');

{
    const repoRequire = Module.createRequire(path.resolve(__dirname, '..', '..', '..', 'package.json'));
    const Database = repoRequire('better-sqlite3');
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-msdb-liveness-'));
    fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
    fs.mkdirSync(path.join(fake, 'data'));
    fs.writeFileSync(path.join(fake, 'data', 'fixture.txt'), 'x');
    core.addProtectedRoot(fake);
    let dbTripped = false;
    try {
        new Database(path.join(fake, 'data', 'bot.db')).close();
    } catch (err) {
        dbTripped = !!err && err.code === 'RAIL_DB_TRIPWIRE';
    }
    if (!dbTripped) refuse('DB tripwire liveness failed on a fake root');
    let dataTripped = false;
    try {
        fs.readFileSync(path.join(fake, 'data', 'fixture.txt'));
    } catch (err) {
        dataTripped = !!err && err.code === 'RAIL_DATA_TRIPWIRE';
    }
    if (!dataTripped) refuse('data fs block liveness failed on a fake root');
}

process.env.DB_PATH = './data/bot.db';
require('ts-node/register/transpile-only');
require('../../../src/utils/db');

// Reaching this line means the import did NOT trip: report it loudly.
process.stderr.write('moduleScopeDb: src/utils/db imported WITHOUT tripping the rails\n');
process.exit(4);
