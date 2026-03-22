import { expect } from "chai";
import { mockEthConfig, mockBscConfig, mockBaseConfig, mockArbConfig, allMockConfigs } from "./fixtures/chainConfig";

describe("ChainRegistry", function () {
  describe("buildChainRegistry()", function () {
    it.skip("should build registry with all 4 chains when ENABLED_CHAINS=eth,bsc,base,arb", async function () {
      // Will import and call buildChainRegistry() after Plan 04-01 creates src/chainRegistry.ts
      // Assert: registry.size === 4
      // Assert: registry.get('eth').chainId === 1
    });

    it.skip("should only enable chains listed in ENABLED_CHAINS", async function () {
      // Set ENABLED_CHAINS=eth,bsc, verify base and arb are not enabled
    });

    it.skip("should default to eth-only when ENABLED_CHAINS is not set", async function () {
      // Unset ENABLED_CHAINS, verify only eth is enabled
    });

    it.skip("should fail fast if enabled chain has no RPC URL", async function () {
      // Set ENABLED_CHAINS=bsc but no BSC_RPC_URL, verify fatal error
    });

    it.skip("should fail fast if unknown chain name is in ENABLED_CHAINS", async function () {
      // Set ENABLED_CHAINS=eth,polygon, verify fatal error on 'polygon'
    });
  });

  describe("ChainConfig validation", function () {
    it("should have correct chainId for each mock config", function () {
      expect(mockEthConfig.chainId).to.equal(1);
      expect(mockBscConfig.chainId).to.equal(56);
      expect(mockBaseConfig.chainId).to.equal(8453);
      expect(mockArbConfig.chainId).to.equal(42161);
    });

    it("should have correct WETH/WBNB addresses", function () {
      expect(mockEthConfig.wethAddress).to.equal('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      expect(mockBscConfig.wethAddress).to.equal('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
      expect(mockBaseConfig.wethAddress).to.equal('0x4200000000000000000000000000000000000006');
      expect(mockArbConfig.wethAddress).to.equal('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
    });

    it("should have at least 2 DEXes per chain", function () {
      for (const config of allMockConfigs) {
        expect(config.dexes.length).to.be.gte(2, `${config.name} should have >= 2 DEXes`);
      }
    });

    it("should assign correct MEV strategy per chain", function () {
      expect(mockEthConfig.mevStrategy).to.equal('flashbots');
      expect(mockBscConfig.mevStrategy).to.equal('bloxroute');
      expect(mockBaseConfig.mevStrategy).to.equal('passthrough');
      expect(mockArbConfig.mevStrategy).to.equal('passthrough');
    });

    it("should route BSC honeypot checks to goplus (not honeypot.is)", function () {
      expect(mockBscConfig.safetyApis.honeypot).to.equal('goplus');
      expect(mockEthConfig.safetyApis.honeypot).to.equal('honeypot.is');
    });

    it("should have gas type matching chain characteristics", function () {
      expect(mockEthConfig.gas.type).to.equal('eip1559');
      expect(mockBscConfig.gas.type).to.equal('legacy');
      expect(mockBaseConfig.gas.type).to.equal('eip1559');
      expect(mockArbConfig.gas.type).to.equal('eip1559');
    });
  });
});
