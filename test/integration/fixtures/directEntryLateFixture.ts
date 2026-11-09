// The wrong order, as a control (plan 22-13): the side-effect import runs before the guard.
import './importMarker';
import { refuseIfDirectEntry } from '../../../src/guards/directEntry';

refuseIfDirectEntry(__filename);
