import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'examples/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain-JS entry shim runs under Bun/Node — expose the runtime globals it uses.
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Stable, widely-adopted hook rules. (We deliberately do not enable the
      // plugin's newer React-Compiler preview rules, which flag intentional
      // timer/`Date.now()` patterns in this live-updating terminal UI.)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The orchestrator/TUI intentionally use a handful of `any` boundaries
      // (SDK event payloads, reconciler host config). Warn rather than block.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests may lean on non-null assertions and looser typing for fixtures.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
