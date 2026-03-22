import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: {
    ...(process.env.ALCHEMY_URL && process.env.PRIVATE_KEY
      ? {
          sepolia: {
            url: process.env.ALCHEMY_URL,
            accounts: [process.env.PRIVATE_KEY],
          },
        }
      : {}),
  },
};

export default config;
