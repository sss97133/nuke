module.exports = {
  env: {
    node: true,
    es2022: true,
    browser: true
  },
  globals: {
    process: 'readonly',
    console: 'readonly',
    window: 'readonly'
  },
  rules: {
    '@typescript-eslint/no-unused-vars': 'warn'
  }
};
