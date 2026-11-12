/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

for (const [path, value] of Object.entries({
  '@sentry/nestjs': { metrics: { count: () => undefined } },
  '@gitroom/nestjs-libraries/upload/upload.factory': { UploadFactory: { createStorage: () => ({}) } },
  '@gitroom/nestjs-libraries/upload/custom.upload.validation': { CustomFileValidationPipe: class {} },
  '@gitroom/nestjs-libraries/integrations/integration.manager': { IntegrationManager: class {}, socialIntegrationList: [] },
  '@gitroom/nestjs-libraries/chat/validation.schemas.helper': { getValidationSchemas: () => ({}) },
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service': { RefreshIntegrationService: class {} },
  '@gitroom/nestjs-libraries/integrations/social.abstract': { RefreshToken: class {} },
  '@gitroom/nestjs-libraries/redis/redis.service': { ioRedis: {} },
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service': { IntegrationService: class {} },
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service': { PostsService: class {} },
  '@gitroom/nestjs-libraries/database/prisma/media/media.service': { MediaService: class {} },
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service': { NotificationService: class {} },
  '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service': { ProviderCredentialService: class {} },
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher': { ssrfSafeDispatcher: {} },
  '@gitroom/helpers/auth/auth.service': { AuthService: class {} },
  '@gitroom/backend/services/auth/permissions/permissions.ability': { CheckPolicies: () => () => undefined },
})) {
  jest.doMock(path, () => value);
}

describe('public API: saving an app with its own redirect URL', () => {
  let controller: any;
  const credentials = { upsert: jest.fn(async () => undefined) };
  beforeEach(async () => {
    jest.clearAllMocks();
    const { PublicIntegrationsController } = await import('./public.integrations.controller');
    controller = new PublicIntegrationsController(
      {} as any, {} as any, {} as any, {} as any,
      { getAllowedSocialsIntegrations: () => ['youtube'] } as any,
      {} as any,
      credentials as any
    );
  });
  const org = { id: 'org-a' } as any;

  it('saves a valid https redirect URL with the app', async () => {
    await controller.upsertProviderCredential(org, 'youtube', {
      clientId: 'id', clientSecret: 's', redirectUrl: 'https://app-one.example.com/oauth/return/youtube',
    });
    expect(credentials.upsert).toHaveBeenCalledWith(
      'org-a', 'youtube', 'id', 's', 'https://app-one.example.com/oauth/return/youtube'
    );
  });

  it('without one, saves the app as before', async () => {
    await controller.upsertProviderCredential(org, 'youtube', { clientId: 'id', clientSecret: 's' });
    expect(credentials.upsert).toHaveBeenCalledWith('org-a', 'youtube', 'id', 's', undefined);
  });

  it('refuses a bad redirect URL with 400 and saves nothing', async () => {
    await expect(
      controller.upsertProviderCredential(org, 'youtube', {
        clientId: 'id', clientSecret: 's', redirectUrl: 'http://app-one.example.com/r',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(credentials.upsert).not.toHaveBeenCalled();
  });
});
