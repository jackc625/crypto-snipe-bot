import { spawn, ChildProcess } from 'child_process';

let hardhatProcess: ChildProcess;

export async function setup() {
    const rpcUrl = process.env.ETH_FORK_RPC_URL || process.env.ALCHEMY_URL;
    if (!rpcUrl) {
        throw new Error('ETH_FORK_RPC_URL or ALCHEMY_URL env var required for fork tests');
    }

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
