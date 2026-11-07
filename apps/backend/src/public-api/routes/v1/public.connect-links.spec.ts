/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@sentry/nestjs', () => ({ metrics: { count: () => undefined } }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/upload/custom.upload.validation', () => ({
  CustomFileValidationPipe: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [],
}));
jest.mock('@gitroom/nestjs-libraries/chat/validation.schemas.helper', () => ({
  getValidationSchemas: () => ({}),
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service',
  () => ({ ProviderCredentialService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({
  ssrfSafeDispatcher: {},
}));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.ability', () => ({
  CheckPolicies: () => () => undefined,
}));
const signJWT = jest.fn((payload: any) => JSON.stringify(payload));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { signJWT: (payload: any) => signJWT(payload) },
}));

import { PublicIntegrationsController } from './public.integrations.controller';

describe('public API: connect links that reconnect a channel', () => {
  const channels: Record<string, any> = {
    yt: { id: 'yt', organizationId: 'org-a', providerIdentifier: 'youtube', internalId: 'yt-account', deletedAt: null, inBetweenSteps: false, refreshNeeded: true },
    gone: { id: 'gone', organizationId: 'org-a', providerIdentifier: 'youtube', internalId: 'g', deletedAt: new Date(), inBetweenSteps: false },
    draft: { id: 'draft', organizationId: 'org-a', providerIdentifier: 'facebook', internalId: 'pending:x', deletedAt: null, inBetweenSteps: true },
    theirs: { id: 'theirs', organizationId: 'org-b', providerIdentifier: 'youtube', internalId: 'b', deletedAt: null, inBetweenSteps: false },
  };
  const integrations = {
    getIntegrationById: jest.fn(async (org: string, id: string) =>
      channels[id]?.organizationId === org ? channels[id] : null
    ),
    getIntegrationsList: jest.fn(async () => [channels.yt]),
  };
  const manager = {
    getAllowedSocialsIntegrations: () => ['youtube', 'x', 'facebook'],
  };
  const controller = new PublicIntegrationsController(
    integrations as any,
    {} as any,
    {} as any,
    {} as any,
    manager as any,
    {} as any,
    {} as any
  );
  const orgA = { id: 'org-a' } as any;
  const payload = () => signJWT.mock.calls.at(-1)?.[0] as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'https://host.example.com';
  });

  it('a link for an own channel is locked to its provider and account', async () => {
    await controller.createConnectLink(orgA, { refresh: 'yt', expiresInHours: 1 });
    expect(payload()).toMatchObject({
      orgId: 'org-a',
      provider: 'youtube',
      refresh: 'yt-account',
    });
    await controller.createConnectLink(orgA, { refresh: 'yt', provider: 'YouTube' });
    expect(payload()).toMatchObject({ provider: 'youtube', refresh: 'yt-account' });
  });

  it.each(['theirs', 'gone', 'draft', 'missing'])(
    'answers 404 for %s and signs nothing',
    async (id) => {
      await expect(
        controller.createConnectLink(orgA, { refresh: id })
      ).rejects.toMatchObject({ status: 404 });
      expect(signJWT).not.toHaveBeenCalled();
    }
  );

  it('refuses a provider that is not the channel provider', async () => {
    await expect(
      controller.createConnectLink(orgA, { refresh: 'yt', provider: 'x' })
    ).rejects.toMatchObject({ status: 400 });
    expect(signJWT).not.toHaveBeenCalled();
  });

  it('a link without refresh is unchanged', async () => {
    await controller.createConnectLink(orgA, { provider: 'x' });
    expect(payload()).not.toHaveProperty('refresh');
    expect(payload()).toMatchObject({ provider: 'x' });
  });

  it('the channel list says which channels need a reconnect', async () => {
    const [listed] = await controller.listIntegration(orgA);
    expect(listed).toMatchObject({ id: 'yt', refreshNeeded: true });
  });
});
