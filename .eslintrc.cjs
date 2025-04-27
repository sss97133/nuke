module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'build', 'vehidex-extension/dist', 'supabase/functions', 'src/scripts', 'src/services/skills.ts', 'src/components/vehicles/VehicleProfile.tsx', 'src/hooks/useAuth.ts'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', '@typescript-eslint'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // Allow some type flexibility for transitional code
    '@typescript-eslint/no-explicit-any': 'warn',
    'react/no-unescaped-entities': 'warn',
    'react/no-unknown-property': 'warn',
    '@typescript-eslint/no-empty-interface': 'warn',
    '@typescript-eslint/no-empty-object-type': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
  },
  overrides: [
    {
      files: ['scripts/**/*.js', 'scripts/**/*.ts', 'scripts/*.js'],
      env: {
        node: true,
        browser: true,
      },
      rules: {
        'no-console': 'off',
        'no-undef': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-unused-vars': 'warn',
        'no-useless-escape': 'warn',
      },
    },
    {
      // Temporarily relax rules for components being refactored
      files: ['src/components/VehicleTimeline/**/*.ts', 'src/components/VehicleTimeline/**/*.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn'
      }
    }
  ],
}; 