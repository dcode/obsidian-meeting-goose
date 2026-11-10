// The ACP SDK ships as ES modules only, so it is transformed like our own code.
const esmPackages = ['@agentclientprotocol/sdk'];

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.(ts|js)$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        allowJs: true,
      },
      diagnostics: { exclude: ['**/node_modules/**'] },
    }],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esmPackages.join('|')})/)`],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/tests/__mocks__/obsidian.ts',
    '^shell-env$': '<rootDir>/tests/__mocks__/shell-env.ts',
  },
};
