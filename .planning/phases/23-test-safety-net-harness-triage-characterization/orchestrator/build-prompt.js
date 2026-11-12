// Orchestrator helper (phase 23 execute-phase, sequential executors). Not part of the bot.
// Usage: node build-prompt.js <plan-id e.g. 23-19> > prompt.md
// Builds the gsd-executor dispatch prompt from executor-prompt-template.md in this folder,
// binding the supplied-root pin and the prior-SUMMARY list. Add plan-specific notes by hand
// (see the <plan_23_NN_notes> blocks described in ../.continue-here.md) before dispatching.
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const ROOT = 'C:/Users/jackc/WebstormProjects/crypto-snipe-bot';
const plan = process.argv[2];
if (!/^23-\d{2}$/.test(plan || '')) { console.error('usage: node build-prompt.js 23-NN'); process.exit(2); }
const phaseDir = '.planning/phases/23-test-safety-net-harness-triage-characterization';
const prior = fs.readdirSync(path.join(ROOT, phaseDir)).filter((f) => /^23-\d{2}-SUMMARY\.md$/.test(f)).sort()
  .map((f) => '${PROJECT_ROOT}/' + phaseDir + '/' + f).join(' ');
const pin = fs.readFileSync(path.join(HERE, 'root-pin-guard.template.sh'), 'utf8')
  .replace("PINNED_ROOT='{PINNED_ROOT}'", `PINNED_ROOT='${ROOT}'`).replace(/\s+$/, '');
let t = fs.readFileSync(path.join(HERE, 'executor-prompt-template.md'), 'utf8');
t = t.split('@@ROOTPIN@@').join(pin).split('@@PHASE_DIR@@').join(phaseDir)
  .split('@@PLAN_FILE@@').join(plan + '-PLAN.md').split('@@PRIOR_SUMMARIES@@').join(prior).split('23-NN').join(plan);
const head = `<objective>\nExecute plan ${plan.split('-')[1]} of phase 23-test-safety-net-harness-triage-characterization.\n[gsd:dispatch phase="23" plan="${plan}"]\nCommit each task atomically. Create SUMMARY.md.\n</objective>\n\n`;
const tail = `\n\n<success_criteria>\n- [ ] All tasks executed\n- [ ] Each task committed individually\n- [ ] SUMMARY.md created in plan directory (with Self-Check)\n- [ ] STATE.md updated with position and decisions\n- [ ] ROADMAP.md updated with plan progress (via \`roadmap update-plan-progress\`)\n- [ ] Full railed npm test on Node 22 run (FOREGROUND) and reported; check.ts partial, consolidation and triage PASS; src/ clean\n</success_criteria>\n`;
const out = head + t + tail;
if (/@@|PINNED_ROOT='\{PINNED_ROOT\}'/.test(out)) { console.error('UNRESOLVED MARKER'); process.exit(1); }
process.stdout.write(out);
