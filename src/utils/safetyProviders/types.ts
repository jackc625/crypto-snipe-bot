// src/utils/safetyProviders/types.ts
// Function signatures for chain-aware safety check dispatchers.
// Each provider adapter implements these signatures, and tokenSafety.ts
// dispatches to the correct adapter based on ChainConfig.safetyApis.

import type { ChainContext } from '../../chainRegistry';

/** Checks whether a token is a honeypot (returns true if honeypot detected). */
export type HoneypotCheckFn = (ctx: ChainContext, tokenAddress: string) => Promise<boolean>;

/** Checks whether liquidity is locked for a pair (returns true if locked). */
export type LiquidityLockCheckFn = (ctx: ChainContext, pairAddress: string) => Promise<boolean>;

/** Returns raw token security data from a provider (or null on failure). */
export type TokenSecurityCheckFn = (ctx: ChainContext, tokenAddress: string) => Promise<Record<string, any> | null>;
