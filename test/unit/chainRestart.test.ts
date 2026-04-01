import { describe, it } from 'vitest';

describe('chain restart callback operations', () => {
    it.todo('reconnects WS provider when wsProvider is null');
    it.todo('runs MEV health check and adds warning if unhealthy');
    it.todo('calls startDexListener for each DEX on the chain');
    it.todo('collects warnings from failed DEX listener starts');
    it.todo('returns empty warnings array on full success');
});
