const base = require('../../config/.next.eslintrc.js')
module.exports = {
  ...base,
  extends: [...base.extends, 'next/core-web-vitals', 'next/typescript'],
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname
  },
  ignorePatterns: [...base.ignorePatterns, 'functions/**/*.ts', 'public/**', '.eslintrc.js']
}
