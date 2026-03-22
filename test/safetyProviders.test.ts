import { expect } from "chai";
import { mockEthConfig, mockBscConfig, mockBaseConfig, mockArbConfig } from "./fixtures/chainConfig";

describe("SafetyProvider routing", function () {
  describe("honeypot check dispatch", function () {
    it("should route ETH honeypot checks to honeypot.is", function () {
      expect(mockEthConfig.safetyApis.honeypot).to.equal('honeypot.is');
    });

    it("should route BSC honeypot checks to GoPlus (per D-13)", function () {
      expect(mockBscConfig.safetyApis.honeypot).to.equal('goplus');
    });

    it("should route Base honeypot checks to honeypot.is", function () {
      expect(mockBaseConfig.safetyApis.honeypot).to.equal('honeypot.is');
    });

    it("should route Arbitrum honeypot checks to GoPlus", function () {
      expect(mockArbConfig.safetyApis.honeypot).to.equal('goplus');
    });
  });

  describe("liquidity lock check dispatch", function () {
    it("should route ETH lock checks to Unicrypt", function () {
      expect(mockEthConfig.safetyApis.liquidityLock).to.equal('unicrypt');
    });

    it("should route BSC lock checks to Mudra", function () {
      expect(mockBscConfig.safetyApis.liquidityLock).to.equal('mudra');
    });

    it("should route Base lock checks to GoPlus", function () {
      expect(mockBaseConfig.safetyApis.liquidityLock).to.equal('goplus');
    });

    it("should route Arbitrum lock checks to GoPlus", function () {
      expect(mockArbConfig.safetyApis.liquidityLock).to.equal('goplus');
    });
  });

  describe("checkHoneypotForChain dispatch", function () {
    it.skip("should call honeypotIsCheck when chain safetyApis.honeypot === 'honeypot.is'", async function () {
      // Will test after Plan 04-03 creates tokenSafety ForChain functions
    });

    it.skip("should call goplusHoneypotCheck when chain safetyApis.honeypot === 'goplus'", async function () {
      // Will test after Plan 04-03
    });
  });

  describe("isLiquidityLockedForChain dispatch", function () {
    it.skip("should call unicryptLockCheck for ETH chains", async function () {
      // Will test after Plan 04-03
    });

    it.skip("should call mudraLockCheck for BSC chains", async function () {
      // Will test after Plan 04-03
    });

    it.skip("should call goplusLiquidityLockCheck for Base/Arb chains", async function () {
      // Will test after Plan 04-03
    });
  });
});
