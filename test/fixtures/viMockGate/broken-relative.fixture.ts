// SAFE-06 fixture: a relative mock of a file that does not exist. Expected: unresolved-relative.
import { vi } from 'vitest';

vi.mock('./does-not-exist', () => ({}));
