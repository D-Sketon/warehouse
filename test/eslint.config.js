const config = require('eslint-config-hexo/ts');

module.exports = [
  ...config,
  {
    'rules': {
      'strict': 0,
      'node/no-unsupported-features/es-syntax': 0,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-unused-expressions': 0,
      '@typescript-eslint/ban-ts-comment': 0,
      '@typescript-eslint/no-empty-function': 0,
      '@typescript-eslint/no-require-imports': 0,
      'n/no-missing-require': 0
    }
  }
];
