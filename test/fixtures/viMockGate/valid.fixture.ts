// SAFE-06 fixture: every specifier form the gate must accept. Expected: no violation.
import { vi } from 'vitest';

vi.mock('./valid-target', () => ({}));
// Written as .js; only valid-target.ts exists.
vi.mock('./valid-target.js', () => ({}));
// A directory that resolves through its index file.
vi.mock('./valid-dir', () => ({}));
vi.mock('ethers', () => ({}));
// A package subpath.
vi.mock('telegram/sessions', () => ({}));
vi.mock(import('./valid-target'), () => ({}));
