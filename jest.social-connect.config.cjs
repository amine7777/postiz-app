// Focused callback regression tests; independent of the legacy Nx Jest preset.
module.exports = {
  testEnvironment: '<rootDir>/test/connection-jsdom-environment.cjs',
  testMatch: [
    '<rootDir>/apps/frontend/src/proxy.connect.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/connect-return.spec.ts',
    '<rootDir>/libraries/helpers/src/auth/connect-return.spec.ts',
    '<rootDir>/apps/frontend/src/components/launches/continue.integration.spec.tsx',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/integration.connection.integration.spec.ts',
  ],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
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
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      },
    ],
  },
};
