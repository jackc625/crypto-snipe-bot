import { describe, it } from 'vitest';

describe('startTelegramListener', () => {
    it.todo('returns null client when TELEGRAM_API_ID is missing');
    it.todo('returns null client when connect() throws');
    it.todo('connects successfully with valid env vars');
    it.todo('whitelist allows all when both lists are empty');
    it.todo('whitelist rejects when sender not in list and channel not in list');
    it.todo('whitelist allows when sender is whitelisted but channel is not');
    it.todo('multi-chain routing calls getCode on each context httpProvider');
    it.todo('multi-chain routing triggers handleAlphaDropForChain only on chains where getCode !== 0x');
});
