// SAFE-06 fixture: a valid mock reached through the vitest namespace. Expected: no violation.
import * as V from 'vitest';

V.vi.mock('./valid-target', () => ({}));
