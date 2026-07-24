module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Limit Jest scans only to the src directory to ignore compiled js tests in dist
  roots: ['<rootDir>/src'],
  // transform TS and JS with ts-jest so modern syntax in the SDK is transpiled
  transform: {
    '^.+\\.(ts|tsx|js|jsx|mjs|cjs)$': 'ts-jest',
  },
  // By default Jest ignores node_modules. Allow transforming @stellar/stellar-sdk
  transformIgnorePatterns: ['/node_modules/(?!@stellar/stellar-sdk)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
