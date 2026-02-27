import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // App source: discourage stray console logs that derail testing
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  // Design system: ban imports of the deprecated design-system.css.
  // The canonical system is src/styles/unified-design-system.css (loaded globally via index.css).
  // The 92 existing imports are legacy — do not add new ones. Migration tracked in Phase 3.
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/design-system.css', '../design-system.css', './design-system.css'],
          message: 'design-system.css is deprecated. Styles are loaded globally via index.css → unified-design-system.css. Remove this import; if you need a token that is missing, add it as an alias in src/styles/unified-design-system.css.',
        }],
      }],
    },
  },
  // Allow console usage in scripts and configuration files
  {
    files: ['scripts/**/*.{js,ts}', 'vite.config.ts', 'eslint.config.js'],
    rules: {
      'no-console': 'off',
    },
  },
)
