---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-11-09T04:56:40.632Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 22 | unrun-verify | test/fork/honeypotDeploy.eth.fork.test.ts |  | UFV-05: moved test 'has bytecode at deployedAddress (not 0x)' has not run in the fork project; owner Phase 25 (ESC-RAILS-01) | open |  | 2026-11-09T04:56:40.632Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "22",
    "file": "test/fork/honeypotDeploy.eth.fork.test.ts",
    "line": null,
    "description": "UFV-05: moved test 'has bytecode at deployedAddress (not 0x)' has not run in the fork project; owner Phase 25 (ESC-RAILS-01)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-11-09T04:56:40.632Z",
    "resolved_at": null,
    "milestone": "v7.0"
  }
]
````
