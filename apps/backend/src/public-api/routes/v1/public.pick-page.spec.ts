/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const signJWT = jest.fn((payload: any) => JSON.stringify(payload));
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
  '@gitroom/helpers/auth/auth.service': { AuthService: { signJWT: (p: any) => signJWT(p) } },
  '@gitroom/backend/services/auth/permissions/permissions.ability': { CheckPolicies: () => () => undefined },
})) {
  jest.doMock(path, () => value);
}

describe('public API: pick the page of a pending channel', () => {
  const rows: Record<string, any> = {
    fb: { id: 'fb', organizationId: 'org-a', providerIdentifier: 'facebook', token: 'user-token', deletedAt: null, inBetweenSteps: true },
    done: { id: 'done', organizationId: 'org-a', providerIdentifier: 'facebook', token: 't', deletedAt: null, inBetweenSteps: false },
    gone: { id: 'gone', organizationId: 'org-a', providerIdentifier: 'facebook', token: 't', deletedAt: new Date(), inBetweenSteps: true },
    theirs: { id: 'theirs', organizationId: 'org-b', providerIdentifier: 'facebook', token: 't', deletedAt: null, inBetweenSteps: true },
    x: { id: 'x', organizationId: 'org-a', providerIdentifier: 'x', token: 't', deletedAt: null, inBetweenSteps: true },
  };
  const facebook = {
    pages: jest.fn(async (): Promise<any[]> => [
      { id: '111', name: 'Bakery', username: 'bakery', access_token: 'PAGE-SECRET-1', picture: { data: { url: 'https://cdn.example.com/b.png' } } },
      { id: '222', name: 'Cafe', access_token: 'PAGE-SECRET-2' },
    ]),
    fetchPageInformation: jest.fn(),
  };
  const integrations = {
    getIntegrationById: jest.fn(async (org: string, id: string) =>
      rows[id]?.organizationId === org ? rows[id] : null
    ),
    saveProviderPage: jest.fn(async () => ({ success: true, id: 'fb' })),
  };
  const manager = {
    getAllowedSocialsIntegrations: () => ['facebook', 'x'],
    getSocialIntegration: (p: string) => (p === 'facebook' ? facebook : { identifier: 'x' }),
  };
  let controller: any;
  const org = { id: 'org-a' } as any;
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'https://host.example.com';
    const { PublicIntegrationsController } = await import('./public.integrations.controller');
    controller = new PublicIntegrationsController(
      integrations as any, {} as any, {} as any, {} as any, manager as any, {} as any, {} as any
    );
  });

  it('lists the pages with display fields only, never a page token', async () => {
    const pages = await controller.listPendingPages(org, 'fb');
    expect(pages).toEqual([
      { id: '111', name: 'Bakery', username: 'bakery', picture: 'https://cdn.example.com/b.png' },
      { id: '222', name: 'Cafe', username: null, picture: null },
    ]);
    expect(JSON.stringify(pages)).not.toContain('SECRET');
    expect(facebook.pages).toHaveBeenCalledWith('user-token');
  });

  it('saves the chosen page through the same page save, scoped to the org', async () => {
    await expect(controller.choosePendingPage(org, 'fb', '222')).resolves.toEqual({ success: true, id: 'fb' });
    expect(integrations.saveProviderPage).toHaveBeenCalledWith('org-a', 'fb', expect.objectContaining({ id: '222', page: '222' }));
  });

  it('a page that is not in the list is 404 and saves nothing', async () => {
    await expect(controller.choosePendingPage(org, 'fb', '999')).rejects.toMatchObject({ status: 404 });
    expect(integrations.saveProviderPage).not.toHaveBeenCalled();
  });

  it.each(['theirs', 'gone', 'done', 'missing'])('%s: 404, nothing listed or saved', async (id) => {
    await expect(controller.listPendingPages(org, id)).rejects.toMatchObject({ status: 404 });
    await expect(controller.choosePendingPage(org, id, '111')).rejects.toMatchObject({ status: 404 });
    expect(facebook.pages).not.toHaveBeenCalled();
    expect(integrations.saveProviderPage).not.toHaveBeenCalled();
  });

  it('a provider without pages is 400; a failing page list is 502', async () => {
    await expect(controller.listPendingPages(org, 'x')).rejects.toMatchObject({ status: 400 });
    facebook.pages.mockRejectedValueOnce(new Error('graph down'));
    await expect(controller.listPendingPages(org, 'fb')).rejects.toMatchObject({ status: 502 });
  });

  it('a connect link can ask for pickInApp; otherwise the token is unchanged', async () => {
    await controller.createConnectLink(org, { provider: 'facebook', pickInApp: true });
    expect(signJWT.mock.calls.at(-1)?.[0]).toMatchObject({ provider: 'facebook', pickInApp: true });
    await controller.createConnectLink(org, { provider: 'facebook' });
    expect(signJWT.mock.calls.at(-1)?.[0]).not.toHaveProperty('pickInApp');
  });
});
