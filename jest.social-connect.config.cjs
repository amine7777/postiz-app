// Focused callback regression tests; independent of the legacy Nx Jest preset.
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: [
    '<rootDir>/apps/frontend/src/components/launches/continue.integration.spec.tsx',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.spec.ts',
  ],
  moduleNameMapper: {
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/libraries/react-shared-libraries/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2020',
          module: 'commonjs',
          jsx: 'react-jsx',
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
