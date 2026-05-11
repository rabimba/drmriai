import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Cornerstone and Transformers.js expose several loosely typed imperative APIs.
      // Keep strict TypeScript for app code while allowing these integration boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
      // This app intentionally derives small bits of UI state when clinical context changes.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
