// src/utils/honeypot/sanitize.ts
//
// Plan 18-CR-03 fix-along: shared sanitizer for any string field that may
// originate from attacker-controlled inputs (RPC error messages, custom
// revert strings, token contract revert payloads) and flow into Telegram
// markdown alerts and the dashboard WebSocket notification fan-out.
//
// Attack surface:
//   1. checkerContract.ts outer try/catch returns `reason: e.message` on
//      unexpected errors. `e.message` can include user-controlled token
//      addresses or arbitrary RPC error strings.
//   2. checkerContract.ts decodeTerminalRevert surfaces parsed revert
//      reasons (BuyFailed / SellFailed / QuoteFailed) into `reason` and
//      `evidence.revertReason`. The string argument to those custom errors
//      is fully attacker-controlled (a malicious token's `transfer` hook
//      can revert with a crafted `string memory reason`).
//   3. bot.ts:251 (V2) and :479 (V3) interpolate `honeypotResult.reason`
//      directly into Telegram markdown WITHOUT escaping. An attacker who
//      deploys a token whose revert string contains markdown special
//      characters can inject markdown formatting, fake hyperlinks
//      (`[text](url)`), or content that mimics the bot's own log lines.
//   4. Every Telegram alert is also broadcast to the dashboard WebSocket
//      as a `notification` event (README:96), so injection propagates to
//      the operator's browser.
//
// Mitigation: strip markdown special characters and clamp to 120 chars
// before any reason string is rendered in an operator-visible surface.
// The clamp also bounds log-aggregator payloads (a single revert reason
// will not blow past a typical log line budget).

const MARKDOWN_SPECIALS = /[`*_\[\]()\\~|<>{}#+=!]/g;
const MAX_REASON_LEN = 120;

/**
 * Sanitize a reason / revert string from any untrusted source before
 * interpolating into Telegram markdown or logging at warn+ levels.
 *
 * - Strips characters meaningful to Telegram MarkdownV2: ` * _ [ ] ( ) \
 *   ~ | < > { } # + = !  (per Telegram MarkdownV2 spec).
 * - Strips ASCII control bytes (0x00-0x1F and 0x7F) to defeat injection
 *   of fake log-line prefixes / ANSI sequences in log aggregators.
 * - Clamps to 120 chars to bound payload size and prevent a single
 *   crafted revert from saturating the alert / log channel.
 * - Returns the literal string 'unknown' for null / undefined input so
 *   callers do not have to null-check at every site.
 */
export function sanitizeReason(reason: string | null | undefined): string {
    if (reason === null || reason === undefined) {
        return 'unknown';
    }
    return String(reason)
        .replace(MARKDOWN_SPECIALS, '')
        // Strip ASCII control characters and DEL. ES2018 \cA-\cZ is brittle
        // across engines; the explicit char-class is exhaustive.
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1F\x7F]/g, '')
        .slice(0, MAX_REASON_LEN);
}
