// scripts/check-mythril-report.ts
//
// HONEY-02 severity-gate CLI for Mythril JSON reports.
//
// Mythril's own CLI does not have a built-in `--fail-on-severity` flag in
// every release (RESEARCH.md §"Slither + Mythril Flags & Severity
// Thresholds" Assumption A1). This wrapper reads a Mythril `-o json`
// report and exits non-zero if any issue has `severity` in
// `{'Medium', 'High'}`.
//
// Used by plan 18-05's audit job:
//   $ mythril analyze contracts/honeypot/HoneypotChecker.sol -o json \
//       > reports/mythril-honeypot.json
//   $ npx ts-node scripts/check-mythril-report.ts reports/mythril-honeypot.json
//
// Behavior:
//   - No arg                                    -> usage to stderr, exit 1
//   - Unparseable JSON                          -> error to stderr, exit 1
//   - report.issues empty or missing            -> "Mythril clean", exit 0
//   - Any issue severity in {Medium, High}      -> details to stderr, exit 1
//   - Only Low / Informational issues           -> "Mythril clean", exit 0
//
// Zero new npm deps — uses Node's built-in `fs` and `process` only
// (per plan 18-03 T-18-SC threat disposition: "Zero new packages").

import * as fs from 'fs';

/**
 * Subset of the Mythril issue shape we depend on.
 * (Full Mythril JSON output also contains: description, code, function,
 * tx_sequence, etc. — we ignore those fields here.)
 */
interface MythrilIssue {
    severity: string;
    title: string;
    'swc-id'?: string;
    filename?: string;
    lineno?: number;
}

interface MythrilReport {
    issues?: MythrilIssue[];
}

function main(): void {
    const reportPath = process.argv[2];

    if (!reportPath) {
        console.error('Usage: ts-node check-mythril-report.ts <report.json>');
        process.exit(1);
    }

    let raw: string;
    try {
        raw = fs.readFileSync(reportPath, 'utf8');
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`check-mythril-report: failed to read '${reportPath}': ${msg}`);
        process.exit(1);
    }

    let report: MythrilReport;
    try {
        report = JSON.parse(raw) as MythrilReport;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`check-mythril-report: failed to parse '${reportPath}' as JSON: ${msg}`);
        process.exit(1);
    }

    const issues = (report.issues ?? []) as MythrilIssue[];
    const blocking = issues.filter((i) => i.severity === 'Medium' || i.severity === 'High');

    if (blocking.length > 0) {
        for (const i of blocking) {
            const swc = i['swc-id'] ?? 'n/a';
            const file = i.filename ?? '?';
            const line = i.lineno ?? '?';
            console.error(`  [${i.severity}] ${i.title} (swc=${swc}, ${file}:${line})`);
        }
        console.error(`Mythril found ${blocking.length} Medium+ issues`);
        process.exit(1);
    }

    console.log(`Mythril clean (no Medium+ issues; total issues=${issues.length})`);
    process.exit(0);
}

main();
