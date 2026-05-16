import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
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
    hardhat: {
      forking: {
        url: process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL || '',
        enabled: !!process.env.ETH_FORK_RPC_URL || !!process.env.ALCHEMY_URL,
      },
    },
  },
};

export default config;
