// test/realpath/triage/fixtures/AUD-ANTIRUG-018-range-limit.ts
// Phase 23 plan 23-10 (orchestrator scope addition; AUDIT-02): a provider that refuses an
// over-range eth_getLogs, for AUD-ANTIRUG-018. Lives beside its test: the harness is read-only for
// triage plans. It adds no behavior to the simulated node; it arms one FakeNode.failNext through the
// public API.
//
// The provider limit being modelled: Alchemy's free tier answers eth_getLogs only for a block range
// of at most 10 blocks per request, counted inclusively ([from, from + 9]); a wider request is
// refused with a JSON-RPC error. The evidence, all in this repository (no live request is sent in
// this phase): Phase 19 research CRITICAL #1 (.planning/milestones/v6.17-phases/
// 19-anti-rug-runtime-monitoring/19-RESEARCH.md) records Alchemy free tier = 10 blocks per query
// and QuickNode free trial = 5 (paid 10,000), each verified against the provider's documentation;
// plan 21-03 measured it on the configured key (test/fork/fixtures/realLaunches/README.md: "the
// configured key is Alchemy FREE tier, which caps eth_getLogs at a 10-block range per request");
// scripts/capture-launch.ts keeps its windows inside that inclusive span; and the bot itself sizes
// its chunked backfill to it (src/chainRegistry.ts ETH backfillCapBlocks 10, "Alchemy free-tier
// safe"). The refusal's code and text below follow Alchemy's documented free-tier answer, as
// recalled, not a recorded response; nothing in the bot reads the text: every eth_getLogs error is
// treated alike (the poller logs it and retries the same range on its next tick).
//
// How the refusal is decided, per request and only from that request's own parameters: failNext's
// `after` predicate runs while the node matches the call, right after the node logged the call on
// node.callLog (FakeNode #one records the call, then checks faults, with no await in between), so
// the last call-log entry is the very request being matched. The predicate checks that it is an
// eth_getLogs and refuses it only when its inclusive range is wider than the limit; a blockHash
// query has no range and passes. A smaller request passes to the node's normal eth_getLogs, so a
// caller that chunks its ranges (the fix) is answered, as a real provider would answer it.

import type { FakeNode, FaultHandle } from '../../harness/chain';

export const FREE_TIER_LOG_RANGE = 10;

/** Arm the range limit on `node` for the rest of the scenario (see the file header). */
export function limitLogRange(node: FakeNode, maxBlocks = FREE_TIER_LOG_RANGE): FaultHandle {
    const blockOf = (tag: unknown): number => {
        if (tag === undefined || tag === null || tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized') return node.head;
        if (tag === 'earliest') return 0;
        return Number(BigInt(String(tag)));
    };
    return node.failNext('eth_getLogs', {
        times: 1_000_000,
        after: () => {
            const call = node.callLog[node.callLog.length - 1];
            if (!call || call.method !== 'eth_getLogs') throw new Error('limitLogRange: the call being matched is not the last call-log entry (the node changed the order it logs and matches calls in)');
            const filter = ((Array.isArray(call.params) ? call.params[0] : undefined) ?? {}) as { fromBlock?: unknown; toBlock?: unknown; blockHash?: unknown };
            if (filter.blockHash !== undefined && filter.blockHash !== null) return false;
            return blockOf(filter.toBlock) - blockOf(filter.fromBlock) + 1 > maxBlocks;
        },
        error: {
            code: -32600,
            message: `Under the Free tier plan, you can make eth_getLogs requests with up to a ${maxBlocks} block range. Upgrade to PAYG for expanded block range.`,
        },
    });
}

/** The eth_getLogs calls sent since `fromCall` whose filter covers `address`, with their inclusive range. */
export function logQueriesFor(node: FakeNode, address: string, fromCall: number): Array<{ seq: number; from: number; to: number; span: number }> {
    return node.callLog
        .slice(fromCall)
        .filter((c) => c.method === 'eth_getLogs' && JSON.stringify(c.params).toLowerCase().includes(address.toLowerCase()))
        .map((c) => {
            const f = (c.params as Array<{ fromBlock?: string; toBlock?: string }>)[0];
            const from = Number(BigInt(String(f.fromBlock)));
            const to = Number(BigInt(String(f.toBlock)));
            return { seq: c.seq, from, to, span: to - from + 1 };
        });
}
