// ignition/modules/HoneypotChecker.ts
// Hardhat Ignition module for deploying the immutable HoneypotChecker contract.
// Per CONTEXT D-CONTRACT-IMMUTABLE: no constructor args, no follow-up calls.
// Per RESEARCH.md §6 lines 877-884.

import { buildModule } from '@nomicfoundation/hardhat-ignition/modules';

export default buildModule('HoneypotCheckerModule', (m) => {
    const checker = m.contract('HoneypotChecker', []);
    return { checker };
});
