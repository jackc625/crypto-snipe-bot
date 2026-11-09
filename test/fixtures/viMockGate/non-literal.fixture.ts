// SAFE-06 fixture: a specifier the gate cannot check. Expected: non-literal.
import { vi } from 'vitest';

const someVariable = './valid-target';
vi.doMock(someVariable, () => ({}));
