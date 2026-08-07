const base = require('../../config/.eslintrc.js')
module.exports = {
  ...base,
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname
  },
  // scripts/ holds manual mainnet tooling; it is outside tsconfig's `include` and is
  // never published (package.json `files` ships dist and README only).
  ignorePatterns: [...base.ignorePatterns, 'functions/**/*.ts', 'scripts/**/*.ts']
}
