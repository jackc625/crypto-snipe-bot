// src/utils/honeypot/abi.ts
// HONEYPOT_CHECKER_ABI: human-readable ABI fragment for the immutable
// HoneypotChecker contract (V2 + V3 entry points per iter-2 Blocker #1).
//
// `as const` is required so ethers `Interface` can introspect the
// function and error fragments at compile time without losing literal
// type information.

export const HONEYPOT_CHECKER_ABI = [
    // V2 entry
    'function checkV2(address router, address token, uint256 amountIn) external payable',
    // V3 entry (iter-2 Blocker #1)
    'function checkV3(address swapRouter, address quoter, address token, uint256 amountIn, uint24 fee) external payable',
    // V2 terminal custom error
    'error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)',
    // V3 terminal custom error (iter-2 Blocker #1)
    'error RoundtripResultV3(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status)',
    // Shared error fragments
    'error BuyFailed(string reason)',
    'error SellFailed(string reason)',
    // V3-only quoter error
    'error QuoteFailed(string reason)',
] as const;
