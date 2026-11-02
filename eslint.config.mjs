import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/cdk.out/**', '**/coverage/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,mjs,cjs,ts}'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  {
    rules: {
      // Money and durations must go through @wm/shared helpers, never floats.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'Use the integer helpers in @wm/shared (money.ts) instead of parseFloat.',
        },
      ],
    },
  },
)
