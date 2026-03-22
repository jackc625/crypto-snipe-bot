// src/utils/abis.ts
// Centralized ABI definitions -- all inline ABI arrays consolidated here.
// Every module that creates Contract instances should import ABIs from this file.

// -- Factory --
export const FACTORY_ABI = [
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

// -- Router --
export const ROUTER_ABI = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory)",
    "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)"
];

// -- ERC20 --
export const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint)",
    "function approve(address spender, uint amount) public returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function tradingEnabled() view returns (bool)"
];

// -- Pair --
export const PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function balanceOf(address owner) view returns (uint256)",
    "function totalSupply() view returns (uint256)"
];

// -- Token limits (optional methods on some tokens) --
export const TOKEN_LIMITS_ABI = [
    "function totalSupply() view returns (uint256)",
    "function maxWalletAmount() view returns (uint256)",
    "function maxWallet() view returns (uint256)",
    "function maxTxAmount() view returns (uint256)",
    "function maxTransactionAmount() view returns (uint256)"
];
