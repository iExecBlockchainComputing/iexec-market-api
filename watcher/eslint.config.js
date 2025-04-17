import importPlugin from 'eslint-plugin-import';
import sonarjsPlugin from 'eslint-plugin-sonarjs';
import prettierConfig from 'eslint-config-prettier/flat';
import globals from 'globals';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  sonarjsPlugin.configs.recommended,
  prettierConfig,
  {
    // default config
    files: ['src/**/*', 'test/**/*'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'default-param-last': 'off',
      'new-cap': 'off',
      'no-console': 'error',
      'no-underscore-dangle': 'off',
      'no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
        },
      ],
      'no-template-curly-in-string': 'off',
      'max-classes-per-file': 'off',
      'max-len': 'off',
      'import/prefer-default-export': 'off',
      'import/extensions': ['error', 'ignorePackages'],
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/todo-tag': 'warn',
    },
    settings: {
      'import/ignore': ['ethers'],
    },
  },
  {
    // test specific files using jest globals
    files: ['test/**/*'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-await-in-loop': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/pseudo-random': 'off',
    },
  },
  {
    files: ['*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: 'script',
    },
  },
];
