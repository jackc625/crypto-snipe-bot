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

// -- V3 Factory --
export const V3_FACTORY_ABI = [
    "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

// -- V3 Pool --
export const V3_POOL_ABI = [
    "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function liquidity() external view returns (uint128)"
];

// -- V3 SwapRouter02 (no deadline in struct -- deadline via multicall wrapper) --
export const V3_SWAP_ROUTER_ABI = [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
    "function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] memory)"
];

// -- V3 QuoterV2 --
export const V3_QUOTER_V2_ABI = [
    "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];
