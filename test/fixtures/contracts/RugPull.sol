// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title RugPull — 5-mode discriminated rug-pull ERC20 fixture for Phase 19
///        anti-rug fork tests.
///
/// @notice Each `mode` selects exactly one rug-pull emission pattern; constructor
///         pins `mode` + `rugDestination` as immutables so the contract behavior
///         is frozen at deploy time (mirrors `Honeypot.sol` precedent).
///
///         The detector dispatches by topic-filter on the contract address, so
///         this contract emits the V2 / V3 rug-pull events DIRECTLY rather than
///         through a separate mock pair/pool contract. The detector does not
///         need a real Uniswap pair/pool — it consumes by topic-filter on the
///         contract address it has registered, and the test sets THIS contract's
///         address as the pair/pool address in the registered RegisteredPosition.
///
/// Modes (uint8 discriminator):
///   0 = v2-burn-to-eoa      V2 Pair.Burn → rugDestination (EOA, NOT allowlisted)
///                           → multi-signal AND fires → verdict='unsafe'
///   1 = v2-burn-to-locker   V2 Pair.Burn → rugDestination (UNCX locker; allowlisted)
///                           → allowlist short-circuit → verdict='allowlisted'
///   2 = v2-burn-to-dead     V2 Pair Transfer → 0x000...dEaD (canonical burn)
///                           → allowlist short-circuit → verdict='allowlisted'
///   3 = v3-burn-collect     V3 Pool.Burn + Pool.Collect → rugDestination
///                           → multi-signal AND fires → verdict='unsafe'
///   4 = v3-burn-only        V3 Pool.Burn only (NO Collect within grace window)
///                           → grace-timeout re-evaluation per ANTIRUG-14
///                              Blocker 2 resolution (a): the AND chain re-evaluates
///                              against live pool state at grace timeout — deterministic
///                              verdict based on signal state at that moment.
contract RugPull is ERC20 {
    // -----------------------------------------------------------------
    // V2 events (re-declared locally so this contract can emit them
    // without proxying through a real UniswapV2Pair instance).
    // -----------------------------------------------------------------

    /// @dev V2 Pair.Burn — same canonical signature as UniswapV2Pair.sol.
    ///      The detector's PAIR_BURN_TOPIC matches this signature.
    event Burn(
        address indexed sender,
        uint256 amount0,
        uint256 amount1,
        address indexed to
    );

    // ERC20 standard Transfer event is inherited from OpenZeppelin's ERC20.
    // The detector's PAIR_TRANSFER_TOPIC matches the inherited signature:
    //   event Transfer(address indexed from, address indexed to, uint256 value)

    // -----------------------------------------------------------------
    // V3 events (re-declared locally with the exact field shape from
    // IUniswapV3PoolEvents.sol — see 19-RESEARCH.md §1.2).
    // -----------------------------------------------------------------

    /// @dev V3 Pool.Burn — matches `POOL_BURN_TOPIC` in src/anti-rug/events.ts.
    ///      owner is the FIRST indexed param (allowlist anchor on V3); there is
    ///      NO `to` field on V3 Burn (per 19-RESEARCH.md CRITICAL #3).
    event V3PoolBurn(
        address indexed owner,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );

    /// @dev V3 Pool.Collect — matches `POOL_COLLECT_TOPIC`. `recipient` is data-
    ///      only (NOT indexed) per the canonical V3 event ABI. The detector uses
    ///      `owner` (topics[1]) as the allowlist anchor per D-V3-ALLOWLIST.
    event V3PoolCollect(
        address indexed owner,
        address recipient,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint128 amount0,
        uint128 amount1
    );

    // -----------------------------------------------------------------
    // Immutable state (pinned at construction; matches Honeypot.sol shape)
    // -----------------------------------------------------------------

    /// @notice The discriminator (0..4). See contract docstring for the mapping.
    uint8 public immutable mode;

    /// @notice The destination address emitted in Burn / Transfer events.
    ///         For modes 0/3/4: typically a non-allowlisted EOA → expected verdict='unsafe'.
    ///         For mode 1: typically a known locker (Unicrypt UniLockerV2 ETH) → expected 'allowlisted'.
    ///         For mode 2: ignored (Transfer-to-dead uses 0x...dEaD literal regardless).
    address public immutable rugDestination;

    /// @notice Canonical 0xdEaD burn address used by mode 2 (Transfer-to-dead pattern).
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 _mode,
        address _rugDestination
    ) ERC20(name_, symbol_) {
        require(_mode <= 4, "RugPull: invalid mode (expected 0..4)");
        mode = _mode;
        rugDestination = _rugDestination;
    }

    // -----------------------------------------------------------------
    // Test scaffolding
    // -----------------------------------------------------------------

    /// @notice Mint helper for test setup. Mirrors the FakeToken.sol /
    ///         Honeypot.sol public mint API used by the fork tests.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // -----------------------------------------------------------------
    // The rug-pull entrypoint
    // -----------------------------------------------------------------

    /// @notice Emit the configured rug-pull event(s) by dispatching on `mode`.
    ///
    ///         Fork-test workflow:
    ///           1. Deploy RugPull(name, symbol, mode, rugDestination).
    ///           2. Mint supply (via `mint`) and arrange for the detector to
    ///              treat THIS contract's address as the pair/pool address of a
    ///              registered position.
    ///           3. Call `executeRug(...)` — emits the V2 / V3 rug-pull events
    ///              matching the detector's topic filter union.
    ///           4. Assert evaluateRugSignals returns the expected RugEvaluation.
    ///
    /// @param pairOrPool An optional address payload (informational; emitted
    ///                   as part of the V2 Burn amount0/amount1 narration in the
    ///                   indexed `sender` field for audit traceability). The
    ///                   detector does NOT read this — only the contract's own
    ///                   address (matched by topic filter) and the event payload.
    function executeRug(address pairOrPool) external {
        // Probe amounts — values are not load-bearing for the detector
        // (signal-1 derives from live pair/pool state read in the evaluator,
        // not from the event's amount fields). Non-zero values keep the
        // payload realistic for any future regression test that inspects them.
        uint256 amt0 = 1e18;
        uint256 amt1 = 1e18;

        if (mode == 0) {
            // V2 Burn → EOA (non-allowlisted). Expected verdict='unsafe'.
            emit Burn(pairOrPool, amt0, amt1, rugDestination);
        } else if (mode == 1) {
            // V2 Burn → locker (allowlisted). Expected verdict='allowlisted'.
            emit Burn(pairOrPool, amt0, amt1, rugDestination);
        } else if (mode == 2) {
            // V2 Transfer → 0xdEaD (allowlisted via canonical burn address).
            // Emits an ERC-20 standard Transfer event from this contract to
            // DEAD_ADDRESS via the inherited _transfer hook. _mint to self
            // first so the burn-style transfer has a positive `value`.
            _mint(address(this), amt0);
            _transfer(address(this), DEAD_ADDRESS, amt0);
        } else if (mode == 3) {
            // V3 Pool.Burn + Pool.Collect to EOA. Expected verdict='unsafe'.
            // Tick range [-100, 100] is arbitrary (informational only — the
            // detector compares topic[1] which is the indexed `owner` field).
            emit V3PoolBurn(rugDestination, -100, 100, 1e18, amt0, amt1);
            emit V3PoolCollect(
                rugDestination,
                rugDestination,
                -100,
                100,
                uint128(amt0),
                uint128(amt1)
            );
        } else if (mode == 4) {
            // V3 Pool.Burn only — no Collect within grace window. The V3
            // path's Burn-without-Collect grace timer (ANTIRUG-14 Blocker 2
            // resolution (a)) holds `pendingV3Burn[poolAddress]` and the
            // grace-timeout block-watcher re-evaluates against live pool
            // state. Deterministic verdict (no "depending on liquidity drop
            // magnitude" ambiguity — depends on what the LIVE pool state
            // reports at grace timeout).
            emit V3PoolBurn(rugDestination, -100, 100, 1e18, amt0, amt1);
        }
        // No `else` branch — constructor already enforces mode <= 4.
    }
}
