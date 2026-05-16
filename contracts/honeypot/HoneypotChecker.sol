// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ---------------------------------------------------------------------------
// Local interfaces (no Uniswap interfaces ship in @openzeppelin/contracts ^5.4.0)
// ---------------------------------------------------------------------------

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router02 {
    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function getAmountsOut(uint amountIn, address[] calldata path)
        external view returns (uint[] memory amounts);

    function WETH() external view returns (address);
}

interface ISwapRouter02 {
    // NOTE: SwapRouter02 dropped the `deadline` field that the original
    // ISwapRouter ExactInputSingleParams struct carried.
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);

    function WETH9() external view returns (address);
}

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );
}

/// @title HoneypotChecker — immutable pre-buy roundtrip simulator (V2 + V3)
/// @notice Designed to be called via eth_call with a non-zero msg.value. Always
///         reverts at end to roll back state; result is encoded in the revert
///         payload as RoundtripResult (V2) or RoundtripResultV3 (V3).
///
/// @dev    status bitmap (shared between V2 and V3 paths):
///           bit 0 (0x01) = sold-back-some-eth (post-sell ETH/WETH balance increased)
///           bit 1 (0x02) = balance-nonzero-after-buy (catches lying-balanceOf)
///           bit 2 (0x04) = sell-completed-without-revert
///         Caller MUST require status === 0x07 to consider the token safe.
///
/// @dev    D-CONTRACT-IMMUTABLE: no owner key, no proxy, no killSwitch,
///         no selfdestruct, no tx.origin use. Patch path is deploy-v2-at-new-address.
contract HoneypotChecker {
    // -----------------------------------------------------------------------
    // Custom errors — terminal revert channels (V2 + V3 + shared)
    // -----------------------------------------------------------------------

    /// @notice V2 terminal result; always reverted, never returned.
    error RoundtripResult(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status);

    /// @notice V3 terminal result; always reverted, never returned.
    error RoundtripResultV3(uint256 buyTaxBps, uint256 sellTaxBps, uint8 status);

    /// @notice Buy-side assertion failure (shared V2 + V3).
    error BuyFailed(string reason);

    /// @notice Sell-side assertion failure (shared V2 + V3).
    error SellFailed(string reason);

    /// @notice V3 quoter revert (V3 only — V2 uses getAmountsOut which is view-only and rarely reverts).
    error QuoteFailed(string reason);

    // -----------------------------------------------------------------------
    // V2 entry: checkV2
    // -----------------------------------------------------------------------

    /// @notice Run V2 roundtrip: buy `token` via `router` with `amountIn` ETH, then sell back.
    /// @dev    msg.value MUST equal amountIn. Always reverts.
    function checkV2(address router, address token, uint256 amountIn) external payable {
        require(msg.value == amountIn, "VALUE_MISMATCH");

        IUniswapV2Router02 r = IUniswapV2Router02(router);
        address weth = r.WETH();

        // Buy: returns (received, buyTaxBps, status-with-bit-1-set)
        (uint received, uint buyTaxBps, uint8 status) = _v2Buy(r, weth, token, amountIn);

        // Sell: returns (sellTaxBps, status-with-bits-0+2-set)
        uint sellTaxBps;
        (sellTaxBps, status) = _v2Sell(r, weth, token, router, received, status);

        revert RoundtripResult(buyTaxBps, sellTaxBps, status);
    }

    function _v2Buy(
        IUniswapV2Router02 r,
        address weth,
        address token,
        uint256 amountIn
    ) private returns (uint received, uint buyTaxBps, uint8 status) {
        address[] memory pathBuy = new address[](2);
        pathBuy[0] = weth;
        pathBuy[1] = token;

        // Expected output via getAmountsOut (curve math — no transfer hook)
        uint expectedTokensOut = r.getAmountsOut(amountIn, pathBuy)[1];

        uint balBefore = IERC20(token).balanceOf(address(this));
        try r.swapExactETHForTokens{value: amountIn}(
            0, pathBuy, address(this), block.timestamp + 60
        ) returns (uint[] memory) {
            // OK
        } catch Error(string memory reason) {
            revert BuyFailed(reason);
        } catch {
            revert BuyFailed("unknown");
        }
        uint balAfter = IERC20(token).balanceOf(address(this));
        if (balAfter <= balBefore) {
            revert BuyFailed("BUY_BAL_ZERO"); // lying-balanceOf catch
        }
        status = 0x02;
        received = balAfter - balBefore;
        buyTaxBps = expectedTokensOut > received
            ? ((expectedTokensOut - received) * 10000) / expectedTokensOut
            : 0;
    }

    function _v2Sell(
        IUniswapV2Router02 r,
        address weth,
        address token,
        address router,
        uint received,
        uint8 statusIn
    ) private returns (uint sellTaxBps, uint8 status) {
        status = statusIn;
        IERC20(token).approve(router, received);

        address[] memory pathSell = new address[](2);
        pathSell[0] = token;
        pathSell[1] = weth;

        uint expectedEthOut = r.getAmountsOut(received, pathSell)[1];

        uint ethBefore = address(this).balance;
        try r.swapExactTokensForETHSupportingFeeOnTransferTokens(
            received, 0, pathSell, address(this), block.timestamp + 60
        ) {
            status |= 0x04;
        } catch Error(string memory reason) {
            revert SellFailed(reason);
        } catch {
            revert SellFailed("unknown");
        }
        uint ethAfter = address(this).balance;
        if (ethAfter <= ethBefore) {
            revert SellFailed("SELL_ETH_ZERO"); // silent-zero-ETH-on-sell catch
        }
        status |= 0x01;
        uint receivedEth = ethAfter - ethBefore;
        sellTaxBps = expectedEthOut > receivedEth
            ? ((expectedEthOut - receivedEth) * 10000) / expectedEthOut
            : 0;
    }

    // -----------------------------------------------------------------------
    // V3 entry: checkV3
    // -----------------------------------------------------------------------

    /// @notice Run V3 roundtrip: buy `token` via `swapRouter` (SwapRouter02) using
    ///         `quoter` (QuoterV2) for expected-output tax math, then sell back.
    /// @dev    msg.value MUST equal amountIn. Always reverts.
    function checkV3(
        address swapRouter,
        address quoter,
        address token,
        uint256 amountIn,
        uint24 fee
    ) external payable {
        require(msg.value == amountIn, "VALUE_MISMATCH");

        // If WETH9() reverts (some V3 router clones don't expose it), the
        // entire checkV3 reverts — which is fail-closed at the dispatcher.
        address weth = ISwapRouter02(swapRouter).WETH9();

        // Buy: returns (received, buyTaxBps, status-with-bit-1-set)
        (uint received, uint buyTaxBps, uint8 status) =
            _v3Buy(swapRouter, quoter, weth, token, amountIn, fee);

        // Sell: returns (sellTaxBps, status-with-bits-0+2-set)
        uint sellTaxBps;
        (sellTaxBps, status) =
            _v3Sell(swapRouter, quoter, weth, token, received, fee, status);

        revert RoundtripResultV3(buyTaxBps, sellTaxBps, status);
    }

    function _v3Buy(
        address swapRouter,
        address quoter,
        address weth,
        address token,
        uint256 amountIn,
        uint24 fee
    ) private returns (uint received, uint buyTaxBps, uint8 status) {
        // ----- Quote expected buy output -----
        uint expectedTokensOut;
        try IQuoterV2(quoter).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: weth,
                tokenOut: token,
                amountIn: amountIn,
                fee: fee,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 amountOut, uint160, uint32, uint256) {
            expectedTokensOut = amountOut;
        } catch {
            revert QuoteFailed("buy-quote-failed");
        }

        // ----- Execute buy -----
        uint balBefore = IERC20(token).balanceOf(address(this));

        try ISwapRouter02(swapRouter).exactInputSingle{value: amountIn}(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: token,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 amountOut) {
            received = amountOut;
        } catch Error(string memory reason) {
            revert BuyFailed(reason);
        } catch {
            revert BuyFailed("v3-buy-unknown");
        }

        // V3 returns the actual amountOut directly, BUT cross-check against
        // IERC20.balanceOf to catch the lying-balanceOf attack even on V3.
        uint balAfter = IERC20(token).balanceOf(address(this));
        if (balAfter - balBefore < received) {
            revert BuyFailed("BUY_BAL_LIE");
        }
        if (received == 0) {
            revert BuyFailed("BUY_BAL_ZERO");
        }
        status = 0x02;

        buyTaxBps = expectedTokensOut > received
            ? ((expectedTokensOut - received) * 10000) / expectedTokensOut
            : 0;
    }

    function _v3Sell(
        address swapRouter,
        address quoter,
        address weth,
        address token,
        uint received,
        uint24 fee,
        uint8 statusIn
    ) private returns (uint sellTaxBps, uint8 status) {
        status = statusIn;

        // ----- Quote expected sell output -----
        uint expectedEthOut;
        try IQuoterV2(quoter).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: token,
                tokenOut: weth,
                amountIn: received,
                fee: fee,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 amountOut, uint160, uint32, uint256) {
            expectedEthOut = amountOut;
        } catch {
            revert QuoteFailed("sell-quote-failed");
        }

        // ----- Execute sell -----
        IERC20(token).approve(swapRouter, received);

        try ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: token,
                tokenOut: weth,
                fee: fee,
                recipient: address(this),
                amountIn: received,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256) {
            status |= 0x04;
        } catch Error(string memory reason) {
            revert SellFailed(reason);
        } catch {
            revert SellFailed("v3-sell-unknown");
        }

        // V3 SwapRouter02 returns WETH (not ETH) to the recipient unless
        // unwrapWETH9 is called separately. We accept the WETH balance
        // as the success signal. The contract did not hold WETH prior to
        // checkV3 (it received ETH only), so wethAfter == wethReceived.
        uint wethReceived = IWETH(weth).balanceOf(address(this));
        if (wethReceived == 0) {
            revert SellFailed("V3_SELL_WETH_ZERO");
        }
        status |= 0x01;

        sellTaxBps = expectedEthOut > wethReceived
            ? ((expectedEthOut - wethReceived) * 10000) / expectedEthOut
            : 0;
    }

    /// @notice Receive ETH refund from V2 router (V2 returns leftover ETH on
    ///         swapExactTokens* variants when value is over-sent). V3 does not
    ///         refund but receive() is harmless to keep.
    receive() external payable {}
}
