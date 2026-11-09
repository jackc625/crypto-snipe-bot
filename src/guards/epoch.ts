// src/guards/epoch.ts
//
// Phase 22 plan 22-12 (SAFE-03, D-05): the module-graph epoch sentinel.
//
// The IDENTITY of this object is the signal. It is created once each time this module is
// evaluated, so it changes only when the whole module graph is re-evaluated (for example
// `vi.resetModules()`). `createdAt` only helps a person reading an error message.
//
// src/guards/singleton.ts compares these objects to tell "the whole graph was reset" (allowed)
// from "this one module was loaded a second time" (refused).

export const EPOCH: Readonly<{ createdAt: number }> = Object.freeze({ createdAt: Date.now() });
