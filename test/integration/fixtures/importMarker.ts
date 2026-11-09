// A stand-in for an import with side effects (plan 22-13): writes the file named by argv[2] when loaded.
import * as fs from 'fs';

fs.writeFileSync(process.argv[2], 'imported');
