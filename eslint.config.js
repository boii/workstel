import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', '.local-release/**', '.wrangler/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        localStorage: 'readonly',
        document: 'readonly',
        crypto: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        TextEncoder: 'readonly',
        navigator: 'readonly',
        HTMLElement: 'readonly',
        KeyboardEvent: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] } },
    rules: { 'vue/multi-word-component-names': ['error', { ignores: ['App'] }] },
  },
  prettier,
);
