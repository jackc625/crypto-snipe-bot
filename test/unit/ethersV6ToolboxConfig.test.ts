// test/unit/ethersV6ToolboxConfig.test.ts
// ETH6-04: Verifies Hardhat v6 toolbox configuration is valid.
// Checks:
// (1) ethers 6.16+ is installed (package.json dependency)
// (2) hardhat.config.ts imports @nomicfoundation/hardhat-toolbox (v6 toolbox)
// (3) eslint.config.mjs has the restrict-plus-operands rule
// (4) No @nomiclabs/* packages remain in package.json
// (5) tsconfig.bot.json targets ES2022 for full BigInt support

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function readFile(relPath: string): string {
    return readFileSync(join(ROOT, relPath), 'utf-8');
}

function readJson(relPath: string): Record<string, unknown> {
    return JSON.parse(readFile(relPath));
}

describe('ETH6-04: Hardhat v6 toolbox configuration is valid', () => {

    describe('package.json — dependency versions', () => {
        it('ethers is installed at version 6.16.0', () => {
            const pkg = readJson('package.json') as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            const ethersVersion =
                pkg.dependencies?.['ethers'] ?? pkg.devDependencies?.['ethers'];

            expect(ethersVersion).toBeDefined();
            // Must start with 6.16 (exact pin or caret/tilde prefix)
            expect(ethersVersion).toMatch(/^[\^~]?6\.16\./);
        });

        it('@nomicfoundation/hardhat-toolbox is installed at v6', () => {
            const pkg = readJson('package.json') as {
                devDependencies?: Record<string, string>;
            };
            const toolboxVersion = pkg.devDependencies?.['@nomicfoundation/hardhat-toolbox'];

            expect(toolboxVersion).toBeDefined();
            // Must be major version 6
            expect(toolboxVersion).toMatch(/^[\^~]?6\./);
        });

        it('@nomicfoundation/hardhat-ethers is installed at v3 (ethers v6 adapter)', () => {
            const pkg = readJson('package.json') as {
                devDependencies?: Record<string, string>;
            };
            const hardhatEthersVersion = pkg.devDependencies?.['@nomicfoundation/hardhat-ethers'];

            expect(hardhatEthersVersion).toBeDefined();
            // Must be major version 3 (the v6-compatible adapter)
            expect(hardhatEthersVersion).toMatch(/^[\^~]?3\./);
        });

        it('no @nomiclabs/* packages remain in dependencies or devDependencies', () => {
            const pkg = readJson('package.json') as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            const allPackageNames = [
                ...Object.keys(pkg.dependencies ?? {}),
                ...Object.keys(pkg.devDependencies ?? {}),
            ];
            const v5Packages = allPackageNames.filter(name => name.startsWith('@nomiclabs/'));

            expect(
                v5Packages,
                `Found legacy @nomiclabs/* packages: ${v5Packages.join(', ')}`
            ).toHaveLength(0);
        });

        it('ethereum-waffle is not installed', () => {
            const pkg = readJson('package.json') as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            const allPackageNames = [
                ...Object.keys(pkg.dependencies ?? {}),
                ...Object.keys(pkg.devDependencies ?? {}),
            ];
            expect(allPackageNames).not.toContain('ethereum-waffle');
        });

        it('eslint 9 and typescript-eslint are installed', () => {
            const pkg = readJson('package.json') as {
                devDependencies?: Record<string, string>;
            };
            const eslintVersion = pkg.devDependencies?.['eslint'];
            const tsEslintVersion = pkg.devDependencies?.['typescript-eslint'];

            expect(eslintVersion).toBeDefined();
            expect(eslintVersion).toMatch(/^[\^~]?9\./);

            expect(tsEslintVersion).toBeDefined();
            expect(tsEslintVersion).toMatch(/^[\^~]?8\./);
        });
    });

    describe('hardhat.config.ts — toolbox import', () => {
        it('imports @nomicfoundation/hardhat-toolbox (v6 toolbox)', () => {
            const content = readFile('hardhat.config.ts');
            expect(content).toContain('@nomicfoundation/hardhat-toolbox');
        });

        it('does not import any @nomiclabs/* package', () => {
            const content = readFile('hardhat.config.ts');
            expect(content).not.toMatch(/@nomiclabs\//);
        });
    });

    describe('eslint.config.mjs — BigInt safety rule', () => {
        it('imports typescript-eslint', () => {
            const content = readFile('eslint.config.mjs');
            expect(content).toContain("from 'typescript-eslint'");
        });

        it('has restrict-plus-operands rule configured', () => {
            const content = readFile('eslint.config.mjs');
            expect(content).toContain('restrict-plus-operands');
        });

        it('restrict-plus-operands is set to error severity', () => {
            const content = readFile('eslint.config.mjs');
            // The rule must appear as 'error' not just 'warn'
            expect(content).toMatch(/'@typescript-eslint\/restrict-plus-operands'\s*:\s*\[\s*'error'/);
        });
    });

    describe('tsconfig.bot.json — ES2022 target for BigInt support', () => {
        it('targets ES2022', () => {
            const tsconfig = readJson('tsconfig.bot.json') as {
                compilerOptions?: { target?: string };
            };
            expect(tsconfig.compilerOptions?.target).toBe('ES2022');
        });
    });
});
