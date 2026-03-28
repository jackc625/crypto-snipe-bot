import { describe, it, expect, beforeAll } from 'vitest';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// Real Uniswap V2 addresses on mainnet (available on fork)
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Hardhat default account #0
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Minimal ABIs for the contracts we interact with
const FACTORY_ABI = [
    'function createPair(address tokenA, address tokenB) external returns (address pair)',
    'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];
const ROUTER_ABI = [
    'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
    'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];
const ERC20_ABI = [
    'function balanceOf(address account) external view returns (uint256)',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function totalSupply() external view returns (uint256)',
];

describe('Snipe Lifecycle on Forked Mainnet (TEST-05)', () => {
    let provider: ethers.JsonRpcProvider;
    let deployer: ethers.Wallet;
    let fakeToken: ethers.Contract;
    let factory: ethers.Contract;
    let router: ethers.Contract;
    let pairAddress: string;
    let initialEthBalance: bigint;

    beforeAll(async () => {
        // Connect to forked Hardhat node
        provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);

        // Instantiate Uniswap V2 contracts
        factory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, deployer);
        router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, deployer);

        // Record initial ETH balance
        initialEthBalance = await provider.getBalance(deployer.address);
    });

    it('should deploy FakeToken and mint supply', async () => {
        // Load compiled artifact
        const artifactPath = path.resolve(__dirname, '../../artifacts/contracts/FakeToken.sol/FakeToken.json');
        const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));

        // Deploy FakeToken
        const contractFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
        const deployed = await contractFactory.deploy('FakeToken', 'FAKE');
        await deployed.waitForDeployment();

        fakeToken = new ethers.Contract(await deployed.getAddress(), [...artifact.abi, ...ERC20_ABI], deployer);

        // Mint 1,000,000 tokens to deployer
        const mintAmount = ethers.parseEther('1000000');
        const mintTx = await fakeToken.mint(deployer.address, mintAmount);
        await mintTx.wait();

        const balance = await fakeToken.balanceOf(deployer.address);
        expect(balance).toBe(mintAmount);
    });

    it('should create Uniswap V2 pair', async () => {
        const tokenAddress = await fakeToken.getAddress();
        const createTx = await factory.createPair(tokenAddress, WETH);
        await createTx.wait();

        pairAddress = await factory.getPair(tokenAddress, WETH);
        expect(pairAddress).not.toBe(ethers.ZeroAddress);
    });

    it('should add liquidity to the pair', async () => {
        const tokenAddress = await fakeToken.getAddress();
        const liquidityTokens = ethers.parseEther('100000');
        const liquidityEth = ethers.parseEther('1');

        // Approve router to spend tokens
        const approveTx = await fakeToken.approve(await router.getAddress(), liquidityTokens);
        await approveTx.wait();

        // Add liquidity: 100,000 FAKE + 1 ETH
        const block = await provider.getBlock('latest');
        const deadline = block!.timestamp + 300;

        const addLiqTx = await router.addLiquidityETH(
            tokenAddress,
            liquidityTokens,
            0, // amountTokenMin
            0, // amountETHMin
            deployer.address,
            deadline,
            { value: liquidityEth },
        );
        const receipt = await addLiqTx.wait();
        expect(receipt.status).toBe(1);
    });

    it('should buy tokens (simulate snipe)', async () => {
        const tokenAddress = await fakeToken.getAddress();
        const buyAmount = ethers.parseEther('0.01');

        const block = await provider.getBlock('latest');
        const deadline = block!.timestamp + 300;

        const buyTx = await router.swapExactETHForTokens(
            0, // amountOutMin
            [WETH, tokenAddress],
            deployer.address,
            deadline,
            { value: buyAmount },
        );
        await buyTx.wait();

        const tokenBalance = await fakeToken.balanceOf(deployer.address);
        // Deployer had 900,000 tokens left after adding 100,000 liquidity, plus bought more
        expect(tokenBalance).toBeGreaterThan(ethers.parseEther('900000'));
    });

    it('should check price (simulate monitoring)', async () => {
        const tokenAddress = await fakeToken.getAddress();

        // Get current sell value for 1000 tokens
        const checkAmount = ethers.parseEther('1000');
        const amounts = await router.getAmountsOut(checkAmount, [tokenAddress, WETH]);

        // amounts[1] is the ETH output
        expect(amounts[1]).toBeGreaterThan(0n);
    });

    it('should sell tokens (simulate exit)', async () => {
        const tokenAddress = await fakeToken.getAddress();
        const tokenBalance = await fakeToken.balanceOf(deployer.address);

        // Approve router to spend all tokens
        const approveTx = await fakeToken.approve(await router.getAddress(), tokenBalance);
        await approveTx.wait();

        const ethBefore = await provider.getBalance(deployer.address);

        const block = await provider.getBlock('latest');
        const deadline = block!.timestamp + 300;

        const sellTx = await router.swapExactTokensForETH(
            tokenBalance,
            0, // amountOutMin
            [tokenAddress, WETH],
            deployer.address,
            deadline,
        );
        await sellTx.wait();

        const ethAfter = await provider.getBalance(deployer.address);
        expect(ethAfter).toBeGreaterThan(ethBefore);
    });

    it('should verify lifecycle complete', async () => {
        // All tokens sold
        const finalTokenBalance = await fakeToken.balanceOf(deployer.address);
        expect(finalTokenBalance).toBe(0n);

        // ETH balance should be reasonably close to initial (lost some to gas + slippage)
        const finalEthBalance = await provider.getBalance(deployer.address);
        // We started with ~10000 ETH (Hardhat default), so final should still be > 9990 ETH
        expect(finalEthBalance).toBeGreaterThan(ethers.parseEther('9990'));
    });
});
