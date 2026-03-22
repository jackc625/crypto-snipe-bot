import { ethers } from "ethers";
import * as dotenv from "dotenv";
import FakeTokenJson from "../artifacts/contracts/FakeToken.sol/FakeToken.json";
import WETHJson from "../artifacts/contracts/interfaces/IWETH.sol/IWETH.json"; // assume you have an IWETH interface
import UniswapV2Router02Json from "../artifacts/contracts/UniswapV2Router02.sol/UniswapV2Router02.json";
import UniswapV2FactoryJson from "../artifacts/contracts/UniswapV2Factory.sol/UniswapV2Factory.json";
import { CONFIG } from "../src/config";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

async function main() {
    const addressPath = path.join(__dirname, "../src/addresses.json");
    const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));

    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
    const factory = new ethers.Contract(CONFIG.factoryAddress, UniswapV2FactoryJson.abi, wallet);

    const token = new ethers.Contract(CONFIG.tokenAddress, FakeTokenJson.abi, wallet);
    const weth = new ethers.Contract(CONFIG.wethAddress, WETHJson.abi, wallet);
    const router = new ethers.Contract(CONFIG.routerAddress, UniswapV2Router02Json.abi, wallet);

    const tokenAmount = ethers.parseUnits("1000", 18); // 1000 tokens

    const balance = await provider.getBalance(wallet.address);
    const gasBuffer = ethers.parseEther("0.005"); // leave ~0.005 ETH for gas
    const maxWrapAmount = balance - gasBuffer;
    const wethAmount = maxWrapAmount > 0n ? maxWrapAmount : 0n;

    const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes

    console.log("⛏️  Minting tokens to deployer...");
    await token.mint(wallet.address, tokenAmount); // you control this token
    console.log("✅ Minting done.");

    console.log("🔁 Wrapping ETH into WETH...");
    if (wethAmount === 0n) {
        console.error("❌ Not enough ETH to wrap. Top up your wallet.");
        return;
    }
    const depositTx = await weth.deposit({ value: wethAmount });
    await depositTx.wait();
    console.log("✅ Wrapped ETH into WETH.");

    console.log("⏳ Approving router to spend tokens...");
    const approveTx = await token.approve(CONFIG.routerAddress, tokenAmount);
    await approveTx.wait();
    console.log("✅ Token approval successful.");

    console.log("⏳ Approving router to spend WETH...");
    const approveWethTx = await weth.approve(CONFIG.routerAddress, wethAmount);
    await approveWethTx.wait();
    console.log("✅ WETH approval successful.");

    console.log("💧 Adding liquidity...");
    const tx = await router.addLiquidity(
        CONFIG.tokenAddress,
        CONFIG.wethAddress,
        tokenAmount,
        wethAmount,
        0,
        0,
        await wallet.getAddress(),
        deadline,
        { gasLimit: 300_000 }
    );
    const receipt = await tx.wait();
    console.log("✅ Liquidity added. TX:", receipt.transactionHash);


    const pairAddress = await factory.getPair(addresses.tokenAddress, addresses.wethAddress);
    addresses.pairAddress = pairAddress;

    fs.writeFileSync(addressPath, JSON.stringify(addresses, null, 2));
    console.log("📦 Created Pair Address:", pairAddress);



}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
