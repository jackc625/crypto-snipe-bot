---
quick_id: 260518-jsr
title: Inspect entire codebase and write a brand-new, fully-updated README.md
date: 2026-05-18
status: ready_for_planning
mode: quick-full
---

# Quick Task 260518-jsr: Brand-new README.md - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Task Boundary

Deeply inspect the entire existing codebase and write a brand-new, polished `README.md` at the project root. Replace any existing README. The README will be read by engineers, technical interviewers, and hiring managers. The full source of truth is `readme-prompt.md` in the repo root, which the planner and executor MUST treat as the canonical brief.

**In scope:** The single root `README.md` file. Deep codebase inspection to ensure every claim is grounded in real code.

**Out of scope:**
- Refactoring or changing application code
- Updating ancillary docs (`HONEYPOT-SIM-BRIEFING.md`, `GOING-LIVE.md`, `.planning/*`, contract READMEs)
- Generating screenshots, GIFs, or external artifacts
- Adding badges that link to external CI/registries the user hasn't already configured

</domain>

<decisions>
## Implementation Decisions

### Audience tone
- **Engineer-first.** Lead with architecture, stack, and technical depth. Product/business framing stays concise at the top so hiring managers can scan in 30 seconds, but the body is technical and dense.
- Avoid marketing voice. Write like a senior engineer documenting a serious system.

### WIP handling
- **Mark explicitly as WIP** inline in the relevant sections (rather than burying everything in a roadmap dump or hiding it entirely).
- Implemented, working features go into main sections with confident language.
- In-progress / partial features get an inline `**Status:** In Progress` (or similar) tag and a one-line truthful description of where they actually stand today.
- Treat `.planning/STATE.md`, `GOING-LIVE.md`, `HONEYPOT-SIM-BRIEFING.md` as signals — but verify against actual source files before claiming any feature works or doesn't.
- Never invent features. Never describe roadmap aspirations as if implemented.

### Depth
- **Comprehensive deep-dive.** Target roughly 500–800 lines. Substantial Feature Deep Dive section, real Architecture Overview, and Data/Domain Model coverage where the codebase supports it.
- Polished, not bloated. Cut any section that the codebase can't support with real evidence.

### Visual aids
- **Prose + bullets only.** No ASCII diagrams, no Mermaid, no code snippets in the README.
- Lean on strong heading hierarchy, clean bullets, short paragraphs, and well-labeled lists. Quality of writing carries the visual weight.

### Claude's Discretion
- Specific section ordering (within the requirements list in `readme-prompt.md`)
- Whether to include badges (only include trivially-correct ones, e.g. language; skip CI/coverage badges unless the workflow + service is verifiably configured)
- How to group "Key Features" categories — pick groupings that emerge naturally from the codebase
- How to phrase the conclusion — must be short, technical, no hype
- Whether a Project Structure section needs subdirectory tree depth-2 or just top-level — pick whichever produces a more useful, scannable result without becoming noise
- Title styling — pick a clean, professional title; do not invent a tagline that the project does not back up

</decisions>

<specifics>
## Specific Ideas

- The canonical brief lives in `readme-prompt.md` at repo root. Planner and executor MUST read it before drafting.
- The README will replace whatever currently exists at the repo root (if anything). Do not preserve old content out of inertia.
- Sanity-check every major claim against the actual code before writing the final draft (per the prompt's Work Process step 4).
- Where partial implementation exists, describe what is *actually* wired up versus what is scaffolded/planned.
- The project is named "Crypto Snipe Bot" per `package.json` (confirmed via `gsd-sdk query init.quick` output).

</specifics>

<canonical_refs>
## Canonical References

- `readme-prompt.md` — Full brief from the user, source of truth for tone/structure/scope
- `package.json` — Authoritative source of stack, dependencies, scripts, entry point
- `.planning/STATE.md` — Current project state, useful for understanding what's wired up vs. WIP
- `.planning/PROJECT.md` — Project goals/context, useful for the Overview section
- Memory: [project_start_command] — Entry point is `npx ts-node src/bot.ts`
- Memory: [feedback_merge_safety] — Audit before/after destructive changes (README is overwrite — verify before clobbering)

</canonical_refs>
