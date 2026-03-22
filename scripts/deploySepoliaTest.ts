// deploySepoliaTest.ts

import { ethers } from "ethers";
import * as dotenv from "dotenv";
import FakeTokenJson from "../artifacts/contracts/FakeToken.sol/FakeToken.json";
import UniswapV2FactoryJson from "../artifacts/contracts/UniswapV2Factory.sol/UniswapV2Factory.json";
import UniswapV2Router02Json from "../artifacts/contracts/UniswapV2Router02.sol/UniswapV2Router02.json";
import WETHJson from "../artifacts/contracts/interfaces/IWETH.sol/IWETH.json";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);
    const deployer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

    console.log("👷 Deploying with:", await deployer.getAddress());

    // 1. Deploy WETH
    const WETHFactory = new ethers.ContractFactory(WETHJson.abi, WETHJson.bytecode, deployer);
    const weth = await WETHFactory.deploy();
    await weth.waitForDeployment();
    console.log("✅ WETH deployed to:", await weth.getAddress());

    // 2. Deploy FakeToken
    const FakeTokenFactory = new ethers.ContractFactory(
        FakeTokenJson.abi,
        FakeTokenJson.bytecode,
        deployer
    );
    const token = await FakeTokenFactory.deploy(ethers.parseEther("1000000"));
    await token.waitForDeployment();
    console.log("✅ FakeToken deployed to:", await token.getAddress());

    // 3. Deploy Factory
    const FactoryFactory = new ethers.ContractFactory(
        UniswapV2FactoryJson.abi,
        UniswapV2FactoryJson.bytecode,
        deployer
    );
    const factory = await FactoryFactory.deploy(await deployer.getAddress());
    await factory.waitForDeployment();
    console.log("✅ Factory deployed to:", await factory.getAddress());

    // 4. Deploy Router WITH correct WETH address
    const RouterFactory = new ethers.ContractFactory(
        UniswapV2Router02Json.abi,
        UniswapV2Router02Json.bytecode,
        deployer
    );
    const router = await RouterFactory.deploy(
        await factory.getAddress(),
        await weth.getAddress()
    );
    await router.waitForDeployment();
    console.log("✅ Router deployed to:", await router.getAddress());

    // 5. Create Pair (token <> WETH)
    const tx = await factory.createPair(await weth.getAddress(), await token.getAddress());
    const receipt = await tx.wait();

    const iface = new ethers.Interface(UniswapV2FactoryJson.abi);
    const pairCreatedLog = receipt.logs.find((log: { topics: string[]; data: string; address: string }) => {
        try {
            const parsed = iface.parseLog(log);
            return parsed.name === "PairCreated";
        } catch {
            return false;
        }
    });

    const pairAddress = pairCreatedLog
        ? iface.parseLog(pairCreatedLog).args.pair
        : "UNKNOWN";

    console.log("🎯 Pair created:", pairAddress);

    // 📝 Write to config file
    const addressesPath = path.join(__dirname, "../src/addresses.json");
    fs.writeFileSync(addressesPath, JSON.stringify({
        factoryAddress: await factory.getAddress(),
        routerAddress: await router.getAddress(),
        tokenAddress: await token.getAddress(),
        pairAddress,
        wethAddress: await weth.getAddress()
    }, null, 2));

    console.log(`📝 Addresses written to ${addressesPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
