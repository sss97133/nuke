/**
 * Special ESLint configuration for auto-fixing TypeScript errors
 * This configuration is specifically designed for the vehicle-centric architecture
 * and multi-source connector framework to maintain data integrity.
 */

/* eslint-env node */

module.exports = {
  extends: [
    '../.eslintrc.js'
  ],
  rules: {
    // Enhance TypeScript type checking rules
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    
    // Vehicle Timeline specific rules
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': ['error', {
      allowExpressions: true,
      allowTypedFunctionExpressions: true
    }],
    
    // Support for the multi-source connector framework
    '@typescript-eslint/consistent-type-assertions': ['error', {
      assertionStyle: 'as',
      objectLiteralTypeAssertions: 'allow-as-parameter'
    }],
    
    // Auto-fixable rules
    '@typescript-eslint/prefer-optional-chain': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    'prefer-const': 'error',
    'no-extra-boolean-cast': 'error'
  },
  overrides: [
    {
      // Special handling for VehicleTimeline components
      files: ['src/components/VehicleTimeline/**/*.{ts,tsx}'],
      rules: {
        // Add more stringent checks for timeline-related data
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/strict-boolean-expressions': 'error'
      }
    }
  ]
};
