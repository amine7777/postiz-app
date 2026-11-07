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
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/linkedin.page.provider.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/youtube.redirect.spec.ts',
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.provider-credentials.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/provider-credentials/provider-credential.repository.spec.ts',
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.connect-links.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/admin.org-lifecycle.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/organizations/organization.lifecycle.integration.spec.ts',
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.integrations.channel-state.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations/channel-limits.spec.ts',
    '<rootDir>/apps/backend/src/public-api/routes/v1/public.pick-page.spec.ts',
    '<rootDir>/apps/backend/src/api/routes/admin.provision.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/x.provider.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/integrations/social/instagram.analytics.spec.ts',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.org-scope.integration.spec.ts',
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
