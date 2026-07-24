module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  // Limit Jest scans only to the src directory to ignore compiled js tests in dist
  roots: ['<rootDir>/src'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { module: 'ESNext' } }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
