// src/utils/blocklist.ts
// Token and pair blocklist for filtering known-bad addresses.
// Populated manually or via future admin interface.

export const BLOCKLIST = {
    tokens: new Set<string>(),
    pairs: new Set<string>(),
};
