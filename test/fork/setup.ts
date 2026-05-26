import { spawn, execSync, ChildProcess } from 'child_process';
import { ethers } from 'ethers';
import { requireRealMainnetGate } from './helpers/realMainnetGate';

let hardhatProcess: ChildProcess;

export async function setup() {
    const rpcUrl = process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL;
    if (!rpcUrl) {
        throw new Error('ETH_FORK_RPC_URL or ALCHEMY_URL env var required for fork tests');
    }

    // Compile contracts so artifacts exist for deployment
    execSync('npx hardhat compile --quiet', { stdio: 'pipe' });

    hardhatProcess = spawn('npx', ['hardhat', 'node', '--fork', rpcUrl, '--port', '8545'], {
        stdio: 'pipe',
        shell: true,
    });

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Hardhat node startup timeout (30s)')), 30000);
        hardhatProcess.stdout?.on('data', (data: Buffer) => {
            if (data.toString().includes('Started HTTP')) {
                clearTimeout(timeout);
                resolve();
            }
        });
        hardhatProcess.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString();
            if (msg.includes('Error') || msg.includes('EADDRINUSE')) {
                clearTimeout(timeout);
                reject(new Error(`Hardhat node error: ${msg}`));
            }
        });
    });

    // EXIT-LIVE-08 global tripwire (D-GATE-BOTH-LAYERS layer a): the node is up;
    // read its chainId and abort the ENTIRE fork run if it reports real-mainnet
    // chainId 1 without ALLOW_REAL_MAINNET=1. This protects EVERY fork test
    // (including future ones that forget the per-test decorator) from accidentally
    // transacting on real mainnet against the funded prod wallet.
    //
    // The local `hardhat node --fork` reports chainId 31337, so this NEVER fires
    // in CI — it guards against a misconfigured ETH_FORK_RPC_URL/ALCHEMY_URL
    // pointing at a real-mainnet node. We reuse requireRealMainnetGate() rather
    // than re-implementing the predicate, so there is a single source of truth.
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    try {
        await requireRealMainnetGate(provider);
    } catch (err) {
        // Mirror the existing fail-fast throw shape (setup.ts rpc-url check above):
        // surface the violation and abort globalSetup so no test runs.
        throw new Error(
            `Fork globalSetup aborted: the fork node reports real-mainnet chainId 1 ` +
                `without ALLOW_REAL_MAINNET=1 — every fork test is blocked to protect the ` +
                `prod wallet. ${(err as Error).message}`,
        );
    } finally {
        provider.destroy();
    }
}

export async function teardown() {
    if (hardhatProcess) {
        hardhatProcess.kill();
        // Wait for process to exit
        await new Promise<void>((resolve) => {
            hardhatProcess.on('close', () => resolve());
            setTimeout(resolve, 2000); // fallback timeout
        });
    }
}
