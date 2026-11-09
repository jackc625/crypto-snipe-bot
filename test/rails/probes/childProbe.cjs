'use strict';
// test/rails/probes/childProbe.cjs
// Phase 22 plan 22-08 Task 1 — SAFE-02 child-process probe. Run ONLY as a railed child
// (through test/rails/spawnRailedChild.ts, or `node --require ./test/rails/preload.cjs`).
// Prints ONE JSON line describing what the child's rails did. It never names a real host:
// the only non-loopback target is TEST-NET-1 192.0.2.1, and Telegram is checked through the
// pure classifyHost predicate only. It never touches the real data/ folder: the DB and data
// checks run against a temp fake protected root.
//
// Secret hygiene: env values are printed only when they equal the committed test/.env.test
// sentinel or are '' (anything else prints as <redacted-non-sentinel>); fork-shell URL
// values print only when they start with http://127.0.0.1 (else <redacted-non-loopback>).
//
// Flags:
//   --dotenv-gate        plant a fake protected root whose .env sets ALLOW_REAL_MAINNET=1 and
//                        ETH_FORK_RPC_URL=http://127.0.0.1:9/from-dotenv, protect it, then
//                        dotenv.config({path, override: true}) before reporting
//   --rewrite-reinstall  write ALLOW_REAL_MAINNET='1' and ETH_FORK_RPC_URL=
//                        'http://127.0.0.1:9/test-written' into process.env, then call
//                        installRails again with the current mode before reporting

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const Module = require('module');

const core = require('../core.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const repoRequire = Module.createRequire(path.join(REPO_ROOT, 'package.json'));
const dotenv = repoRequire('dotenv');

const args = new Set(process.argv.slice(2));
const sentinels = dotenv.parse(fs.readFileSync(path.join(REPO_ROOT, 'test', '.env.test')));

function safeValue(key) {
    const v = process.env[key];
    if (v === undefined) return null;
    if (v === '' || v === sentinels[key]) return v;
    return '<redacted-non-sentinel>';
}

function loopbackUrlOnly(key) {
    const v = process.env[key];
    if (v === undefined) return null;
    if (v === '' || v.startsWith('http://127.0.0.1')) return v;
    return '<redacted-non-loopback>';
}

function flagValue(key) {
    const v = process.env[key];
    if (v === undefined) return null;
    if (v === '' || v === '0' || v === '1') return v;
    return '<redacted>';
}

function codeOf(err) {
    return err && (err.code || (typeof err.message === 'string' ? err.message.split(':')[0] : null));
}

function makeFakeRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-probe-root-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data', 'fixture.txt'), 'probe-fixture');
    return root;
}

function connectDenied() {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(v);
        };
        const t = setTimeout(() => {
            sock.destroy();
            finish('timeout');
        }, 3000);
        const sock = net.connect({ host: '192.0.2.1', port: 80 });
        sock.on('error', (err) => finish(codeOf(err) === 'E_RAIL_NET_DENIED' ? 'denied' : 'error:' + codeOf(err)));
        sock.on('connect', () => {
            sock.destroy();
            finish('connected');
        });
    });
}

async function main() {
    const out = {};
    let st = core.railsStatus();

    if (args.has('--dotenv-gate') && st.installed) {
        const gate = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-probe-gate-'));
        fs.writeFileSync(path.join(gate, 'package.json'), JSON.stringify({ name: 'crypto-snipe-bot' }));
        fs.writeFileSync(path.join(gate, '.env'), 'ALLOW_REAL_MAINNET=1\nETH_FORK_RPC_URL=http://127.0.0.1:9/from-dotenv\n');
        core.addProtectedRoot(gate);
        dotenv.config({ path: path.join(gate, '.env'), override: true, quiet: true });
        out.dotenvGate = 'attempted';
    }
    if (args.has('--rewrite-reinstall') && st.installed) {
        process.env.ALLOW_REAL_MAINNET = '1';
        process.env.ETH_FORK_RPC_URL = 'http://127.0.0.1:9/test-written';
        core.installRails({ mode: st.mode });
        out.rewriteReinstall = 'attempted';
    }
    st = core.railsStatus();

    out.rails = {
        installed: st.installed,
        mode: st.mode,
        envInstalled: st.envInstalled,
        envBlockInstalled: st.envBlockInstalled,
        dataBlockInstalled: st.dataBlockInstalled,
        dbWrapperInstalled: st.dbWrapperInstalled,
        netDenyInstalled: st.netDenyInstalled,
        udpDenyInstalled: st.udpDenyInstalled,
        telegramDenyInstalled: st.telegramDenyInstalled,
    };
    out.env = {
        TELEGRAM_BOT_TOKEN: safeValue('TELEGRAM_BOT_TOKEN'),
        PRIVATE_KEY: safeValue('PRIVATE_KEY'),
        DASHBOARD_API_KEY: safeValue('DASHBOARD_API_KEY'),
        VITEST: process.env.VITEST === undefined ? null : process.env.VITEST,
    };
    out.netConnect192 = st.netDenyInstalled ? await connectDenied() : 'skipped';
    out.telegramClass = core.classifyHost('api.telegram.org', st.mode || 'full');

    if (st.installed) {
        const fake = makeFakeRoot();
        core.addProtectedRoot(fake);
        const dbPath = path.join(fake, 'data', 'bot.db');
        try {
            const Database = repoRequire('better-sqlite3');
            const db = new Database(dbPath);
            db.close();
            out.fakeDbOpen = 'opened';
        } catch (err) {
            out.fakeDbOpen = codeOf(err) === 'RAIL_DB_TRIPWIRE' ? 'denied' : 'error:' + codeOf(err);
        }
        out.fakeDbCreated = fs.existsSync(dbPath);
        try {
            fs.readFileSync(path.join(fake, 'data', 'fixture.txt'), 'utf8');
            out.fakeDataRead = 'read';
        } catch (err) {
            out.fakeDataRead = codeOf(err) === 'RAIL_DATA_TRIPWIRE' ? 'denied' : 'error:' + codeOf(err);
        }
    } else {
        out.fakeDbOpen = 'not-installed';
        out.fakeDbCreated = false;
        out.fakeDataRead = 'not-installed';
    }

    out.runId = st.installed ? st.runId : null;
    out.forkShell = {
        ETH_FORK_RPC_URL: loopbackUrlOnly('ETH_FORK_RPC_URL'),
        ALLOW_REAL_MAINNET: flagValue('ALLOW_REAL_MAINNET'),
        ALCHEMY_URL: loopbackUrlOnly('ALCHEMY_URL'),
        forkShellKeys: st.installed ? st.forkShellKeys : null,
    };
    const ledger = st.installed ? core.readLedger() : [];
    out.ledger = {
        kinds: ledger.map((e) => e.kind),
        envOverrideTargets: ledger.filter((e) => e.kind === 'env-override').map((e) => e.target),
    };
    process.stdout.write(JSON.stringify(out) + '\n');
}

main().catch((err) => {
    process.stderr.write('childProbe failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(1);
});
