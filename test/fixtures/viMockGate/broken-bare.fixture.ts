// SAFE-06 fixture: a mock of a package that is not installed. Expected: unresolved-bare.
import { vi } from 'vitest';

vi.mock('no-such-package-csb-gate', () => ({}));
