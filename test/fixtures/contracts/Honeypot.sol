// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Honeypot — 5-mode fault-injection ERC20 fixture for Phase 18 fork tests.
/// @notice Each `mode` selects exactly one honeypot pattern; constructor pins the
///         mode + amountTierThreshold as immutables so the contract behavior is
///         frozen at deploy time. Modes 0-3 cover the standard pattern set;
///         mode 4 is the amount-tiered tax pattern consumed by plan 18-09
///         Multi-Amount Tests 6+7 (those tests SET amountTierThreshold via the
///         constructor — they MUST NOT extend this contract; Warning #6).
contract Honeypot is ERC20 {
    // Discriminant — uint8 mode (immutable, pinned at construction):
    //   0 = sell-revert
    //   1 = lying-balanceOf
    //   2 = max-wallet
    //   3 = silent-zero-ETH-on-sell
    //   4 = amount-tiered-tax
    uint8 public immutable mode;

    // mode 4 only — uint256 amountTierThreshold (immutable): transfers with
    // `value > amountTierThreshold` revert. Modes 0-3 ignore this field;
    // constructor commonly receives 0 for those modes.
    uint256 public immutable amountTierThreshold;

    // mode 0 only: captures deploying EOA so mints (from == address(0)) and
    // owner-originated transfers are allowed; all other senders are blocked.
    address private immutable owner_;

    // mode 3 only: the V2 pair address to which sells are routed. Set after
    // pool creation via setPair() (test scaffolding only; no admin keys
    // beyond this single setter, per plan 18-01 spec).
    address public uniswapPair;

    constructor(
        string memory name,
        string memory symbol,
        uint8 _mode,
        uint256 _amountTierThreshold
    ) ERC20(name, symbol) {
        mode = _mode;
        amountTierThreshold = _amountTierThreshold;
        owner_ = msg.sender;
    }

    /// @notice Test scaffolding: register the V2 pair address so mode 3 can
    ///         detect "transfer TO the pair" (= sell) without admin keys.
    function setPair(address p) external {
        uniswapPair = p;
    }

    /// @notice Test mint hook matching FakeToken.sol API.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev OZ 5.x replaces `_beforeTokenTransfer` with `_update`. All five
    ///      honeypot modes are dispatched here based on the immutable `mode`.
    function _update(address from, address to, uint256 value) internal override {
        // mode 0 — sell-revert: allow mints (from == address(0)) and
        // owner-originated transfers; block every other sender (= "sell").
        if (mode == 0) {
            require(from == address(0) || from == owner_, "SELL_BLOCKED");
            super._update(from, to, value);
            return;
        }

        // mode 1 — lying-balanceOf: skip super._update so balanceOf does NOT
        // change, but emit Transfer event manually to mimic a successful
        // transfer (matches the modern lying-balanceOf honeypot pattern).
        if (mode == 1) {
            emit Transfer(from, to, value);
            return;
        }

        // mode 2 — max-wallet trap: after-transfer balance of recipient must
        // not exceed 1% of supply. Skipped on mint (from == address(0)) so
        // the initial liquidity-provider can fund the pair.
        if (mode == 2) {
            if (from != address(0)) {
                require(
                    super.balanceOf(to) + value <= totalSupply() / 100,
                    "MAX_WALLET"
                );
            }
            super._update(from, to, value);
            return;
        }

        // mode 3 — silent-zero-ETH-on-sell: when transferring TO the
        // registered Uniswap pair (= sell), the pair receives only 1 wei
        // regardless of `value`. The sender's full balance is still
        // debited, so the router gets back ~0 ETH on the sell leg.
        if (mode == 3) {
            if (to == uniswapPair && uniswapPair != address(0) && value > 1) {
                super._update(from, to, 1);
                return;
            }
            super._update(from, to, value);
            return;
        }

        // mode 4 — amount-tiered tax (NEW per Warning #6): block transfers
        // exceeding `amountTierThreshold` (mints + burns are exempt). Plan
        // 18-09 Multi-Amount Tests 6+7 SET the constructor arg; they do
        // NOT extend this contract.
        if (mode == 4) {
            if (
                from != address(0) &&
                to != address(0) &&
                value > amountTierThreshold
            ) {
                revert("AMOUNT_TIER_BLOCKED");
            }
            super._update(from, to, value);
            return;
        }

        // Unrecognized mode: fall through to normal ERC20 behavior. Tests
        // MUST select a known mode at deploy; this branch is defensive only.
        super._update(from, to, value);
    }
}
