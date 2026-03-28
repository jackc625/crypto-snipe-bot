import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

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
