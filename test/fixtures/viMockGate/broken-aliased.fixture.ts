// SAFE-06 fixture: a broken mock behind a renamed vi import, which a text search for "vi.mock"
// would miss. Expected: unresolved-relative.
import { vi as v } from 'vitest';

v.mock('./also-missing', () => ({}));
