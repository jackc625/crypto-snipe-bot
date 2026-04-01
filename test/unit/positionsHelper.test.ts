import { describe, it } from 'vitest';

describe('buildPositionsWithLivePrices', () => {
    it.todo('returns live price from queryPrice when available');
    it.todo('falls back to highWaterMark with priceStale:true when queryPrice returns null');
    it.todo('computes unrealizedPnl with net cost basis');
    it.todo('positions with no matching ChainContext get priceStale:true and null currentPrice');
    it.todo('queries all open positions prices in parallel via Promise.all');
    it.todo('filters out closed trades (buy_status !== pending)');
});
