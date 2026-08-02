const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  // The module aliases live in next.config.js (webpack resolve.alias), not in
  // jsconfig/tsconfig paths, so next/jest cannot derive them — mirror them here.
  moduleNameMapper: {
    '^config$': '<rootDir>/app/lib/config.js',
    '^utils$': '<rootDir>/app/lib/utils.js',
    '^fileUtils$': '<rootDir>/app/lib/fileUtils.js',
    '^services/(.*)$': '<rootDir>/app/services/$1',
    '^components/(.*)$': '<rootDir>/app/components/$1',
    '^common/(.*)$': '<rootDir>/app/common/$1',
  },
  // next.config.js also adds the project root to webpack resolve.modules,
  // enabling root-relative imports such as 'app/utils/uploadFile'.
  moduleDirectories: ['node_modules', '<rootDir>'],
};

module.exports = createJestConfig(customJestConfig);
