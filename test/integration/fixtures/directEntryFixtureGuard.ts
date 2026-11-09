// The guard for directEntryFixture.ts, in the shape of src/guards/directEntry.ts for src/bot.ts (plan 22-13).
import * as path from 'path';
import { refuseIfDirectEntry } from '../../../src/guards/directEntry';

refuseIfDirectEntry(path.join(__dirname, 'directEntryFixture.ts'));
