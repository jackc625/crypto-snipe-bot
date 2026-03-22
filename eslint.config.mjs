import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // D-07: Flag BigInt/Number mixing at lint time
      '@typescript-eslint/restrict-plus-operands': ['error', {
        allowNumberAndString: false,
        skipCompoundAssignments: false,
      }],
      // Additional safety: warn on unsafe argument passing
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
  },
  {
    ignores: ['dist/', 'artifacts/', 'cache/', 'typechain-types/', 'node_modules/'],
  },
);
