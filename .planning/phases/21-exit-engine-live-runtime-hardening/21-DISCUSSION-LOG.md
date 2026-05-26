# Phase 21: Exit-Engine Live-Runtime Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 21-exit-engine-live-runtime-hardening
**Areas discussed:** Live-sell capture strategy, Real-mainnet test safety, Real-launch fixtures, Evidence bar + op taxonomy

---

## Live-sell capture strategy (EXIT-LIVE-03/04)

### Q1 — How to obtain the position whose sell we capture?
| Option | Description | Selected |
|--------|-------------|----------|
| Bot-buy a safe token | Force the bot to buy a hand-picked liquid/established token at min size via its real buy path, then capture the exit | ✓ |
| Organic snipe of a launch | Run live, capture whatever it naturally snipes/exits — most realistic, honeypot + timing risk on ~0.009 ETH | |
| Manual buy → inject position | Buy outside the snipe path, register as a tracked position, let the engine sell — isolates sell-path, skips buy pipeline | |

**User's choice:** Bot-buy a safe token.
**Notes:** Decouples buy-side risk from the sell-path evidence we actually need.

### Q2 — Which chain / how to bundle the artifacts?
| Option | Description | Selected |
|--------|-------------|----------|
| One ETH roundtrip, both | Single snipe+exit: buy = Flashbots bundle→mined (04), sell = amount_out (03) | ✓ |
| Separate ETH captures | 04 from one run, 03 from another — more flexible, two roundtrips of gas | |
| Split across chains | 03 on a cheap chain, 04 on ETH — rejected: needs HONEY-04 (Phase 18 scope) | |

**User's choice:** One ETH roundtrip, both.
**Notes:** ETH forced (Flashbots ETH-only; other chains lack deployed checker). Sell must route via Flashbots so the sell leg is itself a 04 artifact (researcher to confirm executeFullSell→sendTxWithRetry→Flashbots on ETH).

### Q3 — How much real ETH to risk / top up?
| Option | Description | Selected |
|--------|-------------|----------|
| No top-up, capture at low gas | Capture at calm gas; 0.00915 ETH covers it; accept post-buy auto-pause; abort if gas spiked | ✓ |
| Small top-up (~+0.01 ETH) | Margin against gas spike + stays above floor post-buy (no auto-pause) | |
| Decide at capture time | Lock the rule, defer the number to capture-day conditions | |

**User's choice:** No top-up, capture at low gas.
**Notes:** Asked clarifying questions first (cost / balance / necessity); ran `npm run preflight` + a read-only balance query → live balance 0.00915 ETH, gas 0.82 gwei base (~$1-3 roundtrip), all 6 ETH preflight checks green. Decided no top-up given sub-1-gwei gas.

### Q4 — How to trigger the sell?
| Option | Description | Selected |
|--------|-------------|----------|
| Tight threshold, engine fires | Configure a TP/stop the position immediately satisfies so the poll loop fires executeFullSell — deterministic + real exit path | ✓ |
| Emergency-sell override | Dashboard force-sell — instant but the manual-override path, not the engine's trigger logic | |
| Fully natural exit | Let trailing-stop/TP/age decide — most realistic, unpredictable timing | |

**User's choice:** Tight threshold, engine fires.
**Notes:** Exercises the real exit-engine path (the thing being verified); captures EXIT-LIVE-03 + -01 telemetry together.

---

## Real-mainnet test safety (EXIT-LIVE-08)

### Q1 — Which wallet does the Area-1 capture use?
| Option | Description | Selected |
|--------|-------------|----------|
| Capture uses prod wallet | Capture runs as the real prod bot on its real wallet — production-under-observation | ✓ |
| Capture uses separate wallet | Provision a separate funded wallet for the capture too — cleaner isolation, adds a key | |

**User's choice:** Capture uses prod wallet.
**Notes:** EXIT-LIVE-08's dedicated-test-wallet rule scopes to the automated suite only.

### Q2 — Does the dedicated test wallet hold real funds?
| Option | Description | Selected |
|--------|-------------|----------|
| Fork-only, zero real ETH | Throwaway address for fork-impersonation signing; holds no real ETH; prod key never in a test | ✓ |
| Small-funded test wallet | Tiny real balance so an operator can run isolated real-mainnet tests under the gate | |

**User's choice:** Fork-only, zero real ETH.
**Notes:** ALLOW_REAL_MAINNET stays a tripwire never actually crossed in normal operation.

### Q3 — How to enforce the chainId===1 / ALLOW_REAL_MAINNET guard?
| Option | Description | Selected |
|--------|-------------|----------|
| Both: global net + decorator | Global test-setup tripwire (aborts whole run) + opt-in per-test decorator | ✓ |
| Global setup tripwire only | One blanket guard; covers all tests, no explicit intent marker | |
| Opt-in decorator only | REQ wording exactly; a test that forgets the wrapper gets no protection | |

**User's choice:** Both: global net + decorator.
**Notes:** Defense-in-depth; CI never sets the gate.

### Q4 — Rehearse the live capture before real money?
| Option | Description | Selected |
|--------|-------------|----------|
| Mainnet-fork rehearsal first | Replay exact sequence on a fork at current block, green, then real run + simulate-before-submit | ✓ |
| Fork rehearsal + Sepolia | Adds a Sepolia dry-run — lower fidelity, extra setup | |
| Straight to mainnet, simulate-only | Skip rehearsal; rely on callStatic + abort-on-revert | |

**User's choice:** Mainnet-fork rehearsal first.
**Notes:** Matches the verify-each-step norm. Fork can't exercise the Flashbots relay leg (covered by FIX-09's tested retry on the real run).

---

## Real-launch fixtures (EXIT-LIVE-09)

### Q1 — How are launches chosen for capture?
| Option | Description | Selected |
|--------|-------------|----------|
| Hand-pick by address | Pick specific safe+tradeable historical ETH launches; record by token address + launch block | ✓ |
| Auto-discover + filter | Grab last N PairCreated, keep the ones that pass on a fork | |
| You decide (planner) | Leave to planner within "fixtures must complete the full lifecycle" | |

**User's choice:** Hand-pick by address.
**Notes:** Deterministic, guaranteed-green; the lifecycle is what's being tested, not launch-discovery.

### Q2 — What should the ≥3 fixtures exercise?
| Option | Description | Selected |
|--------|-------------|----------|
| Varied exit triggers | Each fixture drives a different exit path (full-TP / partial-sell / trailing-stop) = regression net | ✓ |
| Uniform full-sell | All 3 a simple full take-profit — simpler, one branch only | |
| Add a reject-path launch | Include a honeypot launch — largely duplicates honeypots/+rugs/ | |

**User's choice:** Varied exit triggers.
**Notes:** Reject path stays covered by existing honeypots/ + rugs/.

### Q3 — Chain / V2-V3 coverage + count?
| Option | Description | Selected |
|--------|-------------|----------|
| 3 ETH, spread V2+V3 | All ETH; 3 fixtures spread across V2 and V3 — minimum count, both lifecycle paths | ✓ |
| Expand to ~5-6 for full matrix | V2+V3 × each exit trigger separately — best coverage, more maintenance | |
| 3 ETH, V2-only | 3 V2 fixtures; V3 buy→exit→sell not represented in realLaunches/ | |

**User's choice:** 3 ETH, spread V2+V3.

---

## Evidence bar + op taxonomy (EXIT-LIVE-06/10/11)

### Q1 — op-field naming convention?
| Option | Description | Selected |
|--------|-------------|----------|
| Dotted exit.* hierarchy | Namespace.Object.Action, past-tense (exit.poll.cycle, exit.full.executed); matches antirug.*/killswitch.* | ✓ |
| Dotted, but present-tense | Same hierarchy, present/imperative verbs | |
| Keep REQ flat-hyphenated | exit-poll-cycle style — inconsistent with codebase, breaks op:exit.* wildcard | |

**User's choice:** Dotted exit.* hierarchy.
**Notes:** Reword the conflicting REQUIREMENTS EXIT-LIVE-01 example during plan-phase.

### Q2 — op coverage + source of truth?
| Option | Description | Selected |
|--------|-------------|----------|
| Comprehensive ops, DB is truth | Enrich every meaningful exit event; verify against DB receipt-decoded amount_out + receipt, never a metric | ✓ |
| Lean ops, DB is truth | Only major outcomes get op fields; same DB-truth rule | |
| Comprehensive ops, logs as evidence | Treat op-log lines as proof — rejected by success-criterion-4 | |

**User's choice:** Comprehensive ops, DB is truth.
**Notes:** Guards telemetry-masks-issue; the DB/chain is ground truth.

### Q3 — Capture EXIT-LIVE-06 induced or natural?
| Option | Description | Selected |
|--------|-------------|----------|
| Induce deterministically | Dead RPC / connection-drop proxy to fire the chain-restart warning on demand | ✓ |
| Wait for natural drop | Capture when a real RPC hiccup happens organically — unpredictable | |
| Induce + note natural | Induce for the artifact; append natural occurrences as bonus | |

**User's choice:** Induce deterministically.
**Notes:** EXIT-LIVE-05 piggybacks on the Area-1 capture; EXIT-LIVE-07 is a fresh-clone boot.

### Q4 — Evidence acceptance bar + bug posture?
| Option | Description | Selected |
|--------|-------------|----------|
| Strict ground-truth + stop-the-line | Real verifiable artifacts per item; fork pass never closes; any bug → decimal 21.1 | ✓ |
| Strict bar, fix-in-flight allowed | Same artifacts but fix small bugs in-phase — breaks stop-the-line discipline | |
| You decide per item | Per-artifact rigor — risks an inconsistent bar | |

**User's choice:** Strict ground-truth + stop-the-line.
**Notes:** VERIFICATION-EVIDENCE.md (EXIT-LIVE-11) is the single source of truth; consistent with phases 17-20.

---

## Claude's Discretion

- `scripts/capture-launch.ts` CLI shape / output format / archive-RPC source.
- Exact `op`-field set and emit points (within dotted `exit.*` + comprehensive coverage).
- EXIT-LIVE-02 SIGTERM-kill mechanism + fork-test structure.
- Budget-vs-actual poll-telemetry schema (within `{op:'exit.poll.cycle', positions, durationMs, budgetMs:5000, overruns}`).
- How price action drives the varied exits on fork replay.
- `v6.17-VERIFICATION-EVIDENCE.md` document structure (within "single source of truth, strict ground-truth").
- Global tripwire's RPC-detection mechanism.

## Deferred Ideas

- Multi-chain live-artifact capture (after HONEY-04 deploys checker on BSC/Base/Arb).
- Small-funded dedicated test wallet (rejected in favor of fork-only/zero-ETH).
- Sepolia testnet rehearsal (rejected — lower fidelity than mainnet fork).
- Expand `realLaunches/` to a full V2×V3×exit matrix (~5-6 fixtures).
- Synthetic canary-trade monitor (OPS-V2-01) — stays v6.18+.

## Operational notes (during discussion)

- Ran read-only `npm run preflight` + a balance query: wallet `0x46c6D387EAb1669307c33E6f60173ADEe9Da3A5C`, balance 0.00915 ETH, block 25180722, gas 0.82 gwei base; all 6 ETH preflight checks PASS (incl. honeypot-checker-code + Flashbots health). No transactions sent.
- Anomaly flagged for researcher: ROADMAP/STATE show Phase 18 ETH gate complete but REQUIREMENTS.md still lists HONEY-07/08 "Pending" — runtime confirms the ETH gate works; reconcile the doc.
