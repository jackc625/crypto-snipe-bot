import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ignition-ethers";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

// Plan 18-01 Task 1 (Rule 3 — blocking fix): the contrived 5-mode honeypot
// fixture lives at test/fixtures/contracts/Honeypot.sol per the plan's pinned
// path. Hardhat 2.x sources only ./contracts by default, so we override the
// TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS subtask to also include any .sol
// files under test/fixtures/contracts/. Keeping the override narrow (single
// extra directory, recursive .sol filter) avoids pulling node_modules or
// other unintended trees into the compilation set.
subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS, async (_args, _hre, runSuper) => {
  const basePaths: string[] = await runSuper();
  const extraRoot = path.resolve(__dirname, "test/fixtures/contracts");
  if (!fs.existsSync(extraRoot)) return basePaths;
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && full.endsWith(".sol") ? [full] : [];
    });
  return [...basePaths, ...walk(extraRoot)];
});

// Plan 18-06 Task 2: per-chain HoneypotChecker deploy + verify configuration.
//
// CRITICAL (D-DEPLOY-KEY): the four new mainnet networks (mainnet/bsc/base/
// arbitrum) use `DEPLOY_PRIVATE_KEY` — a SEPARATE deploy wallet — NOT the
// bot's `PRIVATE_KEY`. Capability split: if the bot wallet leaks the attacker
// drains funds but CANNOT deploy a malicious checker at a trusted address.
// The pre-existing `sepolia` entry continues to use `PRIVATE_KEY` (sepolia is
// a test-only deploy with no production capital).
//
// Each network entry is conditional on BOTH the chain RPC URL AND
// DEPLOY_PRIVATE_KEY being set. When either is missing, the entry evaluates
// to `undefined`; Hardhat 2.x ignores undefined network entries, preserving
// the "RPC + key both must be set" gate without leaking partial config.
//
// `etherscan.apiKey` block consumed by `@nomicfoundation/hardhat-verify` (in
// package.json devDeps). `arbitrumOne` is the canonical key name expected by
// hardhat-verify for the Arbitrum One mainnet (NOT `arbitrum`).
const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    ...(process.env.ALCHEMY_URL
      ? {
          sepolia: {
            url: process.env.ALCHEMY_URL,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
          },
        }
      : {}),
    ...(process.env.ETH_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
      ? {
          mainnet: {
            url: process.env.ETH_RPC_URL,
            accounts: [process.env.DEPLOY_PRIVATE_KEY],
            chainId: 1,
          },
        }
      : {}),
    ...(process.env.BSC_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
      ? {
          bsc: {
            url: process.env.BSC_RPC_URL,
            accounts: [process.env.DEPLOY_PRIVATE_KEY],
            chainId: 56,
          },
        }
      : {}),
    ...(process.env.BASE_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
      ? {
          base: {
            url: process.env.BASE_RPC_URL,
            accounts: [process.env.DEPLOY_PRIVATE_KEY],
            chainId: 8453,
          },
        }
      : {}),
    ...(process.env.ARB_RPC_URL && process.env.DEPLOY_PRIVATE_KEY
      ? {
          arbitrum: {
            url: process.env.ARB_RPC_URL,
            accounts: [process.env.DEPLOY_PRIVATE_KEY],
            chainId: 42161,
          },
        }
      : {}),
    hardhat: {
      forking: {
        url: process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL || '',
        enabled: !!process.env.ETH_FORK_RPC_URL || !!process.env.ALCHEMY_URL,
      },
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY ?? '',
      bsc: process.env.BSCSCAN_API_KEY ?? '',
      base: process.env.BASESCAN_API_KEY ?? '',
      arbitrumOne: process.env.ARBISCAN_API_KEY ?? '',
    },
  },
};

export default config;
