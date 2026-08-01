module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': 'off',
    // 项目约定的开发偏好
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.config.*', 'test-fixtures/'],
  overrides: [
    {
      // 测试文件允许 console.log（用于打印 fixture 调试信息）+ 关闭 hooks 校验
      // 覆盖 *.test.ts / *.test.tsx / *.smoke.test.tsx（smoke 测试顶层在 src/__smoke__/）
      files: [
        '**/__tests__/**/*.ts',
        '**/__tests__/**/*.tsx',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.smoke.test.ts',
        '**/*.smoke.test.tsx',
      ],
      rules: {
        'no-console': 'off',
        'react-refresh/only-export-components': 'off',
      },
    },
  ],
};
