// Usage: node durations2.js <vitest.json> [minPct]
// For each test in a Vitest JSON report, find its REAL time limit by parsing the test file
// with the TypeScript compiler API: per-test options ({ timeout } object arg or numeric last
// arg), enclosing describe options (same forms), file-level vi.setConfig({ testTimeout }),
// else the project default from vitest.config.ts. Named numeric constants are resolved.
const fs = require('fs');
const path = require('path');
const ts = require(path.resolve('node_modules/typescript'));
const [, , file, minPctArg] = process.argv;
const MIN = Number(minPctArg ?? 50);
const DEF = { unit: 5000, integration: 15000, realpath: 15000 };
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

let CONSTS = {};
function num(node) {
  if (!node) return null;
  if (ts.isIdentifier(node)) return CONSTS[node.text] ?? null;
  if (ts.isNumericLiteral(node)) return Number(node.text.replace(/_/g, ''));
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return num(node.expression);
  if (ts.isBinaryExpression(node)) {
    const a = num(node.left), b = num(node.right);
    if (a == null || b == null) return null;
    const k = node.operatorToken.kind;
    if (k === ts.SyntaxKind.AsteriskToken) return a * b;
    if (k === ts.SyntaxKind.PlusToken) return a + b;
    if (k === ts.SyntaxKind.MinusToken) return a - b;
  }
  return null;
}
function optTimeout(args) {
  for (const a of args) if (ts.isObjectLiteralExpression(a)) {
    for (const p of a.properties) if (ts.isPropertyAssignment(p) && p.name && p.name.getText() === 'timeout') {
      const v = num(p.initializer); return v != null ? v : 'unknown';
    }
  }
  if (args.length >= 3) {
    const last = args[args.length - 1];
    const v = num(last); if (v != null) return v;
    if (last && ts.isIdentifier(last)) return 'unknown';
  }
  return null;
}
function titleOf(arg) {
  if (!arg) return null;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    // it.each / test.each titles carry printf placeholders (%s, %d, ...) or $name fields
    if (/%[sdifjo#]|\$[A-Za-z_]/.test(arg.text)) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = arg.text.split(/%[sdifjo#]|\$[A-Za-z_][A-Za-z0-9_.]*/).map(esc);
      return { re: new RegExp('^' + parts.join('.*?') + '$') };
    }
    return arg.text;
  }
  if (ts.isTemplateExpression(arg)) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = [esc(arg.head.text)];
    for (const sp of arg.templateSpans) parts.push('.*?', esc(sp.literal.text));
    return { re: new RegExp('^' + parts.join('') + '$') };
  }
  return { re: /.^/ }; // computed title: matches nothing
}
function calleeParts(e) {
  let x = e; const parts = [];
  while (x) {
    if (ts.isIdentifier(x)) { parts.unshift(x.text); break; }
    if (ts.isPropertyAccessExpression(x)) { parts.unshift(x.name.text); x = x.expression; continue; }
    if (ts.isCallExpression(x)) { x = x.expression; continue; }
    break;
  }
  return parts;
}
const cache = {};
function limitsFor(fp) {
  if (cache[fp]) return cache[fp];
  const sf = ts.createSourceFile(fp, fs.readFileSync(fp, 'utf8'), ts.ScriptTarget.Latest, true);
  CONSTS = {};
  for (let pass = 0; pass < 3; pass++) {
    (function collect(n) {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && CONSTS[n.name.text] == null) {
        const v = num(n.initializer); if (v != null) CONSTS[n.name.text] = v;
      }
      ts.forEachChild(n, collect);
    })(sf);
  }
  // numeric constants imported from relative modules (e.g. TEST_TIMEOUT_MS from fixtures/crashRun)
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || !st.importClause.namedBindings) continue;
    const spec = st.moduleSpecifier.text; if (!spec.startsWith('.')) continue;
    const nb = st.importClause.namedBindings; if (!ts.isNamedImports(nb)) continue;
    let target = null;
    for (const ext of ['.ts', '.js', '.cjs', '/index.ts']) { const p = path.resolve(path.dirname(fp), spec + ext); if (fs.existsSync(p)) { target = p; break; } }
    if (!target) continue;
    const saved = CONSTS; CONSTS = {};
    const tsf = ts.createSourceFile(target, fs.readFileSync(target, 'utf8'), ts.ScriptTarget.Latest, true);
    for (let pass = 0; pass < 3; pass++) (function c(n) { if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && CONSTS[n.name.text] == null) { const v = num(n.initializer); if (v != null) CONSTS[n.name.text] = v; } ts.forEachChild(n, c); })(tsf);
    const imported = CONSTS; CONSTS = saved;
    for (const el of nb.elements) { const orig = (el.propertyName || el.name).text; if (imported[orig] != null && CONSTS[el.name.text] == null) CONSTS[el.name.text] = imported[orig]; }
  }
  const tests = []; let fileTimeout = null;
  function walk(node, inherited) {
    if (ts.isCallExpression(node)) {
      const parts = calleeParts(node.expression);
      const base = parts[0];
      if (base === 'vi' && parts[1] === 'setConfig') {
        const o = node.arguments[0];
        if (o && ts.isObjectLiteralExpression(o)) for (const p of o.properties)
          if (ts.isPropertyAssignment(p) && p.name.getText() === 'testTimeout') fileTimeout = num(p.initializer) ?? 'unknown';
      }
      if (base === 'describe' || base === 'suite') {
        const t = optTimeout(node.arguments);
        const next = t != null ? t : inherited;
        node.arguments.forEach((a) => walk(a, next));
        return;
      }
      if (base === 'it' || base === 'test') {
        const t = optTimeout(node.arguments);
        tests.push({ title: titleOf(node.arguments[0]), limit: t != null ? t : inherited });
      }
    }
    ts.forEachChild(node, (c) => walk(c, inherited));
  }
  walk(sf, null);
  return (cache[fp] = { tests, fileTimeout });
}
const rows = []; let unmatched = 0;
for (const tr of j.testResults) {
  const rel = path.relative(process.cwd(), tr.name).split(path.sep).join('/');
  const proj = rel.startsWith('test/unit') ? 'unit' : rel.startsWith('test/integration') ? 'integration' : rel.startsWith('test/realpath') ? 'realpath' : 'other';
  let L; try { L = limitsFor(tr.name); } catch { L = { tests: [], fileTimeout: null }; }
  for (const a of tr.assertionResults) {
    let m = L.tests.find((t) => typeof t.title === 'string' && t.title === a.title);
    if (!m) m = L.tests.find((t) => t.title && typeof t.title === 'object' && t.title.re.test(a.title));
    if (!m) unmatched++;
    const lim = m && m.limit != null ? m.limit : (L.fileTimeout ?? DEF[proj] ?? 15000);
    const src = m && m.limit != null ? 'explicit' : (L.fileTimeout != null ? 'file' : (m ? 'default' : 'default?'));
    const d = a.duration ?? 0;
    const pct = typeof lim === 'number' ? Math.round((100 * d) / lim) : -1;
    rows.push({ rel, title: a.title, d, lim, src, pct, status: a.status });
  }
}
const over = rows.filter((r) => r.pct >= MIN || r.pct < 0).sort((a, b) => b.pct - a.pct);
console.log(`tests ${rows.length}, unmatched titles ${unmatched}, at or over ${MIN}% of real limit: ${over.filter((r) => r.pct >= MIN).length}, unknown limit: ${over.filter((r) => r.pct < 0).length}`);
for (const r of over) console.log(`${String(r.pct).padStart(4)}%  ${String(Math.round(r.d)).padStart(6)} / ${String(r.lim).padStart(6)} [${r.src}]  ${r.rel} :: ${r.title.slice(0, 80)}`);
