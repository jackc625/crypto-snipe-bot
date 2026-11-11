# Audit Protocol (Phase 22)

This is the contract every audit executor reads before auditing anything. It covers what an auditor may read, how a finding is graded, what each register file looks like, when and how to escalate, how duplicates merge, and how to commit. `.planning/audit/tools/check.ts` enforces it mechanically and `.planning/audit/tools/render.ts` turns the JSON into the readable `AUDIT-FINDINGS.md` and `OPERATOR-DECISIONS.md`. If this file and a tool disagree, stop and report it. Do not work around it.

Every tool runs on Node 22.16.0 by absolute path (D-21) and refuses any other ABI with `requires Node 22.16.0 (ABI 127)`:

```bash
export PATH="/c/Users/jackc/AppData/Local/nvm/v22.16.0:$PATH"
T=node_modules/ts-node/dist/bin.js
node $T .planning/audit/tools/slice-files.ts --slice BUY          # sorted file list at audit_base_sha
node $T .planning/audit/tools/slice-files.ts --check BUY          # list == files_at_base, anchors present
node $T .planning/audit/tools/slice-files.ts --universe [--sha r] # every tracked file in one slice or scope prefix
node $T .planning/audit/tools/slice-files.ts --snapshot BUY,EXIT --out "$(mktemp -d)/snap"
node $T .planning/audit/tools/check.ts --stage partial --slice BUY
node $T .planning/audit/tools/render.ts --out "$(mktemp -d)"      # audit plans validate rendering only
```

## 1. Audit inputs

- **What you audit:** only the tracked code at `audit_base_sha` (`BASE.json`). Read it from a `slice-files.ts --snapshot` folder outside the repo, or with `git show <sha>:<path>`. Read it from the snapshot or git, **never the working tree**, because the rails plans edit the working tree at the same time. A file that changes later gets a re-audit of its diff (section 3, `re_audit`).
- **Which files:** `slices.json` gives each slice literal `include`/`exclude` entries. An entry ending in `/` is a directory prefix and any other entry is an exact path. `slice-files.ts` is the only way to turn a slice into a file list. It lists the full tree with `git ls-tree -r -z` and filters it in JavaScript. Always use the tool and **never pass glob or brace pathspecs to git**: `'src/api/**'` returns 0 files under `git ls-tree` and 14 under `git ls-files`, and `src/utils/{a,b}.ts` returns 0 under both. The tools reject `*`, `?`, `[` and `{` in any entry.
- **Coverage is checked against the universe, not the selectors.** `scope.json` lists the out-of-scope prefixes with their reasons. Every tracked file must belong to exactly one slice or exactly one out-of-scope prefix (`checkUniverse`). This is checked at `audit_base_sha` (consolidation) and at HEAD (final). A new tracked file that fits neither fails until it is assigned with a literal include entry, or declared out of scope with a reason.
- **What you must not read (P9 anti-anchoring):** prior `.planning` VERIFICATION or SUMMARY docs, phase SUMMARYs and milestone archives. `check.ts` rejects any evidence ref matching `.planning/.*(VERIFICATION|SUMMARY)` (NAC-09).
- **Hints are not evidence.** The RC numbers in `slices.json` and the candidates in the research summary are hints to re-measure. Their line numbers were read at an older commit. Evidence is always code at `audit_base_sha` or a command you ran.
- **Never read** `.env`, `data/`, or the backups. **Never send** anything but tracked source to an external model (D-14).

## 2. Severity, capital impact, lifecycle

| Severity | Meaning |
|---|---|
| S0 | Funds are lost or stranded on a live path with no unusual condition. |
| S1 | Capital can be lost, stranded, overspent or exposed under a plausible condition. |
| S2 | Correctness/robustness defect with bounded or indirect capital effect, or test/infra drift that can hide an S0/S1. |
| S3 | Misleading behavior, telemetry or ops friction. |
| S4 | Hygiene. |

Capital-impact classes (`capital_impact`):

| Class | Meaning |
|---|---|
| LOSS | Funds can be lost. |
| STRAND | A position is held without a working exit or protection. |
| OVERSPEND | More is spent than configured or capped. |
| EXPOSURE | A risk limit or trust boundary is bypassed. |
| none | No capital effect. |

Lifecycle (`status`): `candidate -> confirmed -> decided -> fixed -> verified`, or `NOT-A-BUG`. In Phase 22 no research candidate (an entry with a non-empty `rc`) may be `NOT-A-BUG`. From Phase 23 a research candidate may close as `NOT-A-BUG` only through a Phase 23 triage record (section 7). An RC entry graded below `research_suggested_severity` needs a written `severity_rationale` (NAC-10). The status `deferred` does not exist anywhere in the register (AC-39).

Bug classes are `C01`..`C20` (`classes.json`, AUDIT-03 order). The sweep areas (matrix columns) are `src`, `dashboard`, `test`, `scripts`, `contracts`.

## 3. File schemas

Every item is its own JSON file (D-15), so parallel auditors never edit the same file. IDs are never renumbered. Each slice owns its prefix, so IDs are unique by construction.

| Kind | Path | ID |
|---|---|---|
| finding | `findings/AUD-<SLICE>-NNN.json` | `AUD-<SLICE>-NNN` (3 digits, next free number in your slice) |
| escalation record | `escalations/ESC-<AREA>-NN.json` | `<AREA>` is a slice name, or `PRE` (pre-phase, D-23) or `RAILS` (real defects found while building the rails, 22-08..22-16) |
| process note | `process-notes/PN-NNN.json` | `PN-NNN` |
| decision card (existing OD) | `decisions/OD-NN.json` | `OD-NN` |
| proposed card (new) | `decisions/proposed/<SLICE>-NN.json` | `<SLICE>-NN`; only 22-28's `assign-cards.ts` numbers it `OD-26`+ |
| ledger | `ledger/<SLICE>.json` | ledger-capable slices only |
| sweep | `sweep/<SLICE>.json` | sweep-capable slices only |
| sweep contribution | `sweep/contrib-<NAME>.json` | cross-cutting plans that cannot edit slice files |
| thresholds | `thresholds/<SLICE>.json` | thresholds-capable slices only |

A slice's `capabilities` (`ledger`, `sweep`, `thresholds`, `findings_only`) decide which files it may have. A findings-only slice (RAIL, FORENSIC, SECRET, CENSUS, TESTQ, REAUDIT, OD21) owns no files and has no ledger, sweep or thresholds file. A file for a capability the slice lacks fails the check.

**Finding** (all keys present; `null`, `[]` or `""` where allowed):

- `id`, `title`, `kind` (`finding`).
- `area`: the slice's area. For ROOT and findings-only slices, use the sweep area the finding affects.
- `slice`: the slice that owns the id prefix.
- `severity`, `capital_impact`.
- `classes`: list of `C01`..`C20`.
- `files`: non-empty list of repo paths.
- `evidence`: non-empty list of `{type: code|command, ref, note}`. A code ref is `path:line[-line]@sha`.
- `sibling_sites_checked`: non-empty text naming the sibling sites searched and what was found.
- `status`.
- `origin`: one of `research-candidate`, `independent`, `external`, `rails-discovery`, `re-audit`.
- `rc`: list of zero-padded `RC-NN`.
- `research_suggested_severity`: required when `rc` is non-empty, else `null`.
- `severity_rationale`: string.
- `duplicate_of`: `null` or a finding id.
- `related`: finding ids, or `rc:RC-NN` placeholders until consolidation.
- `tags`: for example `rail`, `secret`, `test-origin-db-row`, `test-quality`, `cross-class`, `capital`, `d-stop-the-line`.
- `secret_class`: required when `tags` includes `secret`. One of `known-public`, `non-public`, `scan-record`; invalid otherwise.
- `escalation_ref`: `null` or a record id.
- `od_ref`: `null`, `OD-NN`, or a proposed id before numbering.
- `recommendation`, `reported_by` (non-empty list), `found_date` (`YYYY-MM-DD`), `audited_sha` (40 hex).

Optional finding keys:

- `pre_phase_key`: the slug a pre-phase `key:` alias resolves to.
- `external_od_refs`: `[{id, owner_phase}]` for cards owned by another phase, such as OD-19 owned by Phase 32.
- `traces`: `[{scenario, steps, outcome}]`. Required wherever a slice plan demands a written trace.
- `sub_claims`: `[{claim, evidence, status}]`, so distinct mechanisms under one RC stay separately verifiable.
- `affected_cases` and `escaped_regression`, for test-quality findings. `escaped_regression` names the concrete regression that could pass while the test stays green. It is required for test-quality S0-S2.
- `input_refs`: `["<file>#<n>"]`, used when a finding resolves an `input:` alias.

**Ledger** `ledger/<SLICE>.json` is a JSON array of rows. Each row is `{path, audited_sha, findings, quality_label?, fixture_provenance?, re_audit?}`.

- `findings` is a list of ids, or `"none"`. A zero-finding file is listed as `none`, never omitted (AC-32).
- A file present at `audit_base_sha` is audited at `audit_base_sha`. Later changes go in `re_audit: [{from_sha, to_sha, findings, note}]`.
- A file added after the base must be listed by the enumerator at HEAD, and its audit must reach the file's last-change SHA (directly or through `re_audit`).
- `quality_label` is for test files (D-20). It holds `{claims, mocks_mechanism: yes|no|partial, mocked_dependencies, mocked_mechanism_detail, hollow_assertions: yes|no, can_reach_real_state: yes|no, cases?, notes}`.
  - `cases` (`[{name, mocks_mechanism, hollow, missing_observable}]`) is required when one file mixes real-path and mechanism-mocking cases (`mocks_mechanism: partial`).
  - At consolidation, every `*.test.ts(x)` row in a test-area ledger needs a `quality_label`.
- `fixture_provenance` is for fixture files: `synthetic`, `public-historical` or `operator-state`.

**Sweep** `sweep/<SLICE>.json` is `{slice, area, audited_sha, cells}`.

- `cells` maps each of `C01`..`C20` to `{result, search}`.
- `result` is a non-empty list of finding ids, or `"checked, none"`.
- `search` names the search performed (patterns and files). It is never empty.

**Sweep contribution** `sweep/contrib-<NAME>.json` is `{name, contributions: [{class, area, ids, search}]}`. render.ts and check.ts merge contributions into the cells of the named area, and 22-28 folds them in. A ROOT finding goes in the cell of the area it affects.

**Thresholds** `thresholds/<SLICE>.json` is either a plain array of rows or `{rows, discovery}`. Both forms are accepted.

- Every row carries every AC-37 field: `id` (`TH-<SLICE>-NN`), `name`, `current_value`, `definition_sites` (every `file:line`), `comparison`, `units`, `representation`, `effective_unset`, `effective_empty`, `effective_non_numeric`, `rationale`, `overlap`, `env_key`, `hardcoded`, `flags`, `recommendation`, `od_ref`.
- Every flagged row has a recommendation.
- Scope (D-19): every number that changes what the bot does with money or when. Cosmetic numbers are excluded.
- The optional `discovery` is `{env_reads: [{key, sites, row_id | excluded_reason}], constants: [...]}`.

**Decision card** is `{id, title, area, capital, status: open|decided, options, keep_current_option_id, recommendation, default, behavior_impact, findings, decided, needed_by, operator_input?}`.

- `options` is `[{id, name, behavior_impact, risk}]`.
- `decided` is `null`, or `{date, ruling}` when decided.
- `operator_input` holds a preference the operator gave before the owning phase decides. It never changes `status`.
- A proposed card may later carry `assigned_id`, `merged_into` or `linked_od` (22-28).
- NAC-12 (P12, cards must not steer or pre-decide): at least 2 options; a keep-current-behavior option (`keep_current_option_id`) that states its risk; no card decided except OD-1, OD-2, OD-7 and OD-21.

**Escalation record** uses the canonical shape from 22-02, plus the optional key `tags`:

- `id`, `date` (the session the item was found).
- `tier`: `immediate`, `area-batch` or `pre-phase`.
- `items`: written once and never edited afterwards. Each item is a finding id or an alias: `rc:RC-NN`, `key:<SLICE>:<slug>`, `input:<file>#<n>` (an index into `inputs/<file>`).
- `resolved_items`: finding ids.
- `summary`, `presented_at`.
- `operator_response`: the operator's own words, verbatim, or `null`.
- `acknowledgement_evidence`: required when `operator_response` is `null`. It names where the operator was told and acknowledged. Operator text is never invented.
- `ruling`: `"none"` when the operator made no ruling.
- `phase_continued`: `true` or `false`. If `false`, the record carries the ruling that stopped the phase.
- `tags` (optional).

A close-out may add `operator_response_recorded_at`, `operator_response_channel`, `ruling_option_text`, `items_ref` and `resolution: {status, outcome, statement, ...}` without changing the as-created fields (ESC-SECRET-01 shows the pattern).

**Process note** is `{id, date, description, evidence}`. It is an honest account of an event that has no escalation tier, for example D-23 (c).

Every register file is written atomically: a temp file outside the scanned folders, then a rename (`writeAtomic` in `tools/lib.ts`).

## 4. Escalation (D-16, AC-39, AC-40)

- **Immediate tier**: stop at once at a blocking checkpoint for any of these:
  - any **S0** finding;
  - any finding tagged **`rail`**;
  - any finding tagged **`test-origin-db-row`**;
  - a secret whose **`secret_class` is `non-public`**.
- **Area-batch tier**: S1 entries, presented together at a blocking checkpoint as soon as the area finishes.
- **Never escalated**: known-public secrets (Hardhat #0) and scan records (AC-35).
- **Pre-phase tier**: the items surfaced in plan-phase and recorded as `ESC-PRE-NN` (D-23 and the 2026-11-06 operator ruling).
- **One record per item.** Every escalated item gets exactly one record, dated the session it was found, and the finding's `escalation_ref` points to it.
- **Rediscoveries.** A rediscovered item sets `escalation_ref` to the existing record and is listed as "already escalated" at the area checkpoint. It is never escalated twice.
- **Second record for one defect.** If two records turn out to exist for one defect, keep the earlier one. The later one becomes a rediscovery link: its `resolved_items` names the canonical finding, and the duplicate finding's `escalation_ref` equals the canonical one.
- **Aliases.** An alias item (`rc:`, `key:`, `input:`) resolves through `resolved_items`, to one or more findings that point back with `escalation_ref`:
  - `rc:RC-NN`: a finding carrying that RC.
  - `key:<SLICE>:<slug>`: a finding of that slice with `pre_phase_key` equal to the slug.
  - `input:<file>#<n>`: a finding with that `input_refs` entry, or a record closed with `resolution.status: closed` and an `outcome`.
- **Check stages.** At stage partial, an escalation-required item without `escalation_ref` and an unresolved alias print as PENDING, because area checkpoints come after the area audit. At consolidation they fail (`input:` aliases fail only at final).
- **Operator rulings (AC-40).** The phase continues after each stop unless the operator rules otherwise. Any ruling is copied into the record, and `operator_response` is never invented.
- **Nothing is fixed in Phase 22 (NAC-13).** Fixes are Phase 24 (capital) and Phase 29 (S2-S4). A behavior-changing recommendation becomes a decision card (AUDIT-05).

## 5. Merge rules (duplicates and cross-class findings)

- **One entry per defect.** A finding found by more than one slice or model is one entry. The others link to it with `duplicate_of`, keep their own ids, and are never renumbered.
- **What the canonical entry carries:**
  - the highest severity of the merged set, with a `severity_rationale` that names the merge (it mentions at least one duplicate id);
  - the union of `classes`, `evidence`, sibling sites and `reported_by`;
  - the single escalation and the single `od_ref`.
- **What a duplicate may keep.** A duplicate may keep an `escalation_ref` or `od_ref` only if it equals the canonical one. A canonical entry is never itself a duplicate.
- **Conflicts.** Conflicting card references or recommendations are resolved in `CONSOLIDATION.json` (`reconciliations`) with the reason.
- **Cross-class findings.** A cross-class finding lists every class, and its id appears in every relevant sweep cell of its area (AC-34).

`check.ts --stage consolidation` enforces these rules. It also checks referential integrity: every `duplicate_of`, `related`, `od_ref`, threshold `od_ref`, `escalation_ref`, `resolved_items` id, ledger finding id, card `findings` id and sweep-cell id must resolve to an existing file, and `external_od_refs` must carry an `owner_phase`.

## 6. Commits and rendering

- **Pathspec commits.** Stage only your slice's files, and commit with a pathspec: `git add -- <paths> && git commit -m "<msg>" -- <paths>`. That way, files another executor has staged never ride along in your commit. Never run a bare `git commit`, `git add -A` or `git add .`, and never stage a directory path that another plan writes into (for example `escalations/`). On `index.lock` contention, wait and retry.
- **Audit-wave commits touch only `.planning/` (AC-33).** All audit tooling lives in `.planning/audit/tools/`.
- **Rendering.** Audit plans run `render.ts --out "$(mktemp -d)"` to validate rendering only. Only 22-04 (first render), 22-28 and 22-29 commit the canonical `AUDIT-FINDINGS.md` and `OPERATOR-DECISIONS.md`.
- **Check stages:**
  - `partial`: run by each audit plan, usually with `--slice <SLICE>`.
  - `consolidation`: run by 22-28 and 22-29 after numbering cards.
  - `final`: run by 22-29. Universe and ledger equality are checked at HEAD, every changed file is re-audited to its last-change SHA, every `input:` alias is resolved, and the census (`census/signing-sites.json`) and full-history scan (`inputs/history-scan.json`) are present.
  - `triage`: the Phase 23 gate (section 7).
- **Exit codes.** `check.ts` exits 0 on pass, 1 on a check failure (each failure is printed with its file and field) and 2 on a crash.

## 7. Phase 23 triage record (D-21; AC-08, AC-11, AC-13, AC-16, AC-17, AC-18)

Phase 23 gives every entry in the triage population exactly one recorded outcome, and `check.ts` checks each outcome's evidence mechanically. Tests are found **by finding ID, never by a file path**, so moving a test file later cannot leave a stale pointer.

**Which stage to run.** `check.ts --stage triage` is Phase 23's gate. It runs the per-file checks, the escalation links, the references and the triage rules, with the triage rules as FAIL. It never runs the consolidation checks or the HEAD universe check. `--stage final` stays the Phase 22 audit completeness stage: it also demands a ledger row and a re-audit row for every file changed since the audit, which is Phase 22's machinery, not this phase's. At `partial` (and `consolidation`, `final`) an unfinished triage item prints as PENDING. One per-file rule still applies at every stage: if a Phase 23 commit edits a file that was **added after `audit_base_sha`** and already has a ledger row, that row needs a `re_audit` entry ending at the file's last-change SHA (for a real review of the diff), or `partial` and `triage` fail.

**The population** is frozen in `inputs/triage-population.json` (`frozen_at_sha`, `count`, sorted `ids`, `severity_at_freeze`). It was written once by plan 23-04: every non-duplicate finding with a non-empty `rc` or severity S0 or S1, plus AUD-ANTIRUG-024 on the operator's ruling (ESC-ANTIRUG-02), 61 IDs. The checker uses these IDs joined with the same computation over the live register, so a later severity change or duplicate link can never shrink the set. A frozen ID whose finding file is gone fails. Never edit the file to remove an ID.

**The record.** A finding's optional `triage` block. Write it only with `tools/set-triage.ts` (the one writer), never by hand:

```bash
node $T .planning/audit/tools/set-triage.ts --id AUD-BUY-002 --outcome confirmed --test-id AUD-BUY-002 --note "<one line>"
node $T .planning/audit/tools/set-triage.ts --help
```

| Key | Meaning |
|---|---|
| `outcome` | `confirmed`, `NOT-A-BUG`, `fixed` or `unreproduced` (exactly one). |
| `phase` | the string `"23"`. |
| `note` | a one-line note. |
| `test_id` | the finding ID of the triage test file that asserts this entry (the lead finding of a shared-cause file). Required for `confirmed`. |
| `proof`, `rail_test` | `fixed`: the rail test and its RED proof; the rail test's exact full title path. |
| `ruling_ref` | the operator review record (`reviews/<ID>.json`) that holds this finding's ruling. |
| `needs_fork`, `fork_question`, `fork_ref` | AC-16: an item that truly needs a fork run; the question; the Phase 25 `UFV-NN` entry in `inputs/unrun-fork-verifications.json`. |
| `manual_evidence` | a repo-relative file holding manual evidence (for example a recorded response); it must exist. |
| `proven_claims`, `open_claims` | `unreproduced`: the knownBug claims that are proven, and what stays unproven. |
| `evidence` | `[{type: code|command, ref, note}]`: why a `NOT-A-BUG` is not a bug (NAC-09 applies). |

Unknown keys fail. `set-triage.ts` sets the status: `confirmed` -> `confirmed`, `NOT-A-BUG` -> `NOT-A-BUG`, `fixed` -> `fixed` (a `verified` finding stays `verified`), `unreproduced` -> unchanged (an unreproduced entry stays open: `candidate`, `confirmed` or `decided`). Recording the same outcome again merges the new flags over the block; a different outcome replaces it.

**The evidence zone and the known-bug marker.** A real-path test proves a bug with `knownBug(ctx, '<finding ID>', { claim: '<kebab-case>', ... })` (`test/realpath/harness/knownBug.ts`). `check.ts` parses every source file under `test/` (TypeScript AST, no type-checking) and only a call in a file `test/realpath/triage/**/<finding ID>.test.ts`, named for a finding in the register, feeds a finding rule. A location guard fails, at every stage, naming the file and the ID:

- a call outside the evidence zone, unless the file is outside `test/realpath/triage/` and the ID is exactly the reserved self-test literal `HARNESS-SELFTEST` (the harness's own self-tests; read by no finding rule, and `ID_RE.finding` refuses it);
- `HARNESS-SELFTEST` anywhere inside `test/realpath/triage/`;
- an ID that is not a string literal, anywhere;
- any use of the name `knownBug` other than a direct call, an unaliased named import (`import { knownBug } from ...`) or its declaration in `test/realpath/harness/knownBug.ts`. An alias, a namespace or default import, a re-export, `require()` or passing it as a value is refused, because it would hide calls from the scan.

The scan reads the working tree, so run the gate on a committed tree.

**Rules per outcome.**

- **`confirmed`**: at least one `knownBug` carrying its own ID in the evidence zone; `test_id` names an existing zone file, and that file asserts this ID (a test covering several entries asserts each one, AC-11). At stage triage: a run-evidence tuple for it from a zone file, and, if it is (or was at the freeze) S0 or S1, its ID in the `acknowledged` list of a review record with an operator response (AC-18).
- **`NOT-A-BUG`**: non-empty `evidence`. If it is S0 or S1 now, or was at the freeze, `ruling_ref` must name a review record with a non-null `operator_response` whose `rulings` lists this exact finding with `ruling: "not-a-bug"` (AC-17, AC-47). A general reply does not count.
- **`fixed`**: a literal marker line `closes-finding: <ID>` next to the rail test in a file under `test/` (for example `// closes-finding: AUD-TX-004 (rail test, RED proof row N of red-proofs/INDEX.md)`), a non-empty `proof`, and `rail_test` with the exact full title path. At stage triage `rail_test` must be in `passed_tests` of the run evidence (AC-13).
- **`unreproduced`**: `ruling_ref` to a review record with an operator response that rules `keep-open` on this finding (AC-08; PENDING at partial, FAIL at triage, because the skip path records the outcome before the review exists). If any `knownBug` cites it, `open_claims` must say what stays unproven, and every `proven_claims` entry must have its `knownBug` call (and, at triage, its run-evidence tuple).
- **`needs_fork: true`**: `fork_question`, and `fork_ref` to a UFV entry whose `owner_phase` is 25 (AC-16; PENDING at partial, FAIL at triage).

**Claim-level proof.** Every `knownBug` in the evidence zone carries a `claim` string literal. A value taken from a variable, a table row or a later spread is not a literal and fails, so a test with several cases writes one call per case, each with its own literal claim (sharing a helper for the setup). A call is valid when its finding's outcome is `confirmed`, or `unreproduced` with the call's claim in `proven_claims`. Any other citation is an orphan and fails (a citation of a finding with no triage record yet is PENDING at partial, FAIL at triage).

**Run evidence** `inputs/triage-evidence.json` is written by plan 23-16 from real Vitest JSON reports: `{tuples: [{finding, file, title, claim, expected, actual}], passed_tests: [full test title]}`, with repo-relative forward-slash paths and no timestamp. A tuple from outside the evidence zone counts for nothing (it prints a WARN). Missing: PENDING at partial, FAIL at triage.

**Operator review record** `reviews/<ID>.json` (for example `TRIAGE-REVIEW-01`), a record type separate from escalations, so no finding's `escalation_ref` or one-record rule changes: `id`, `date`, `summary`, `presented_at`, `operator_response` (verbatim, or `null` before the operator replies), `operator_response_recorded_at`, `acknowledged` (finding IDs), `rulings` (keyed by finding ID, each `{ruling: "not-a-bug" | "keep-open", reason, operator_words}` with the operator's own words for that finding) and `phase_continued`. A record with no operator response holds no acknowledgement or ruling. A `rulings` key must be a population ID. The register must follow each ruling: `not-a-bug` needs outcome `NOT-A-BUG`, `keep-open` needs `unreproduced` or `confirmed` (FAIL at triage). Operator words are never invented or paraphrased.
