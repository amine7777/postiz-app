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
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@gitroom/backend/services/auth/permissions/permissions.ability', () => ({
  CheckPolicies: () => () => undefined,
}));

import { PublicIntegrationsController } from './public.integrations.controller';

describe('public API: disable and enable a channel', () => {
  const channels: Record<string, any> = {
    mine: { id: 'mine', organizationId: 'org-a', deletedAt: null, inBetweenSteps: false },
    gone: { id: 'gone', organizationId: 'org-a', deletedAt: new Date(), inBetweenSteps: false },
    draft: { id: 'draft', organizationId: 'org-a', deletedAt: null, inBetweenSteps: true },
    theirs: { id: 'theirs', organizationId: 'org-b', deletedAt: null, inBetweenSteps: false },
  };
  const integrations = {
    // Scoped like the real repository: only the caller org's rows.
    getIntegrationById: jest.fn(async (org: string, id: string) =>
      channels[id]?.organizationId === org ? channels[id] : null
    ),
    disableChannel: jest.fn(async () => undefined),
    enableChannel: jest.fn<(...args: any[]) => Promise<any>>(async () => undefined),
  };
  const controller = new PublicIntegrationsController(
    integrations as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const orgA = { id: 'org-a', subscription: { totalChannels: 7 } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('disables and enables a channel of the caller org', async () => {
    await expect(controller.disableChannel(orgA, 'mine')).resolves.toEqual({
      id: 'mine',
      disabled: true,
    });
    expect(integrations.disableChannel).toHaveBeenCalledWith('org-a', 'mine');

    await expect(controller.enableChannel(orgA, 'mine')).resolves.toEqual({
      id: 'mine',
      disabled: false,
    });
    expect(integrations.enableChannel).toHaveBeenCalledWith('org-a', 7, 'mine');
  });

  it.each(['theirs', 'gone', 'draft', 'missing'])(
    'answers 404 for %s and writes nothing',
    async (id) => {
      await expect(controller.disableChannel(orgA, id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(controller.enableChannel(orgA, id)).rejects.toMatchObject({
        status: 404,
      });
      expect(integrations.disableChannel).not.toHaveBeenCalled();
      expect(integrations.enableChannel).not.toHaveBeenCalled();
    }
  );

  it('turns the plan limit error into a 403 instead of a 500', async () => {
    integrations.enableChannel.mockRejectedValueOnce(
      new Error('You have reached the maximum number of channels')
    );
    await expect(controller.enableChannel(orgA, 'mine')).rejects.toMatchObject({
      status: 403,
      response: { msg: 'You have reached the maximum number of channels' },
    });
  });
});
