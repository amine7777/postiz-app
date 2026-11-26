/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service',
  () => ({ ProviderCredentialService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    verifyJWT: () => ({
      orgId: 'org-off',
      linkId: 'link',
      expiresAt: '2999-01-01T00:00:00.000Z',
    }),
  },
}));
// The posting activity's own imports, which this spec does not exercise.
for (const path of [
  'nestjs-temporal-core',
  '@temporalio/common',
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  '@gitroom/nestjs-libraries/temporal/temporal.search.attribute',
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  '@gitroom/helpers/utils/strip.html.validation',
]) {
  jest.doMock(path, () => ({
    Activity: () => () => undefined,
    ActivityMethod: () => () => undefined,
    TypedSearchAttributes: class {},
    PostsService: class {},
    NotificationService: class {},
    RefreshIntegrationService: class {},
    IntegrationService: class {},
    WebhooksService: class {},
    SubscriptionService: class {},
    TemporalService: class {},
    stripHtmlValidation: () => '',
  }));
}

import { AdminProvisionController } from './admin.provision.controller';
import { ConnectLinkController } from './connect-link.controller';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';

const token = 'admin-secret';
const live = {
  id: 'org-1',
  apiKey: 'key',
  disabledAt: null as Date | null,
  deletedAt: null as Date | null,
};

describe('admin org lifecycle routes', () => {
  const organizations = {
    getOrgById: jest.fn<(...args: any[]) => Promise<any>>(),
    getOrgsByUserId: jest.fn<(...args: any[]) => Promise<any>>(),
    setDisabled: jest.fn<(...args: any[]) => Promise<any>>(async () => ({})),
    updateApiKey: jest.fn<(...args: any[]) => Promise<any>>(async () => ({
      apiKey: 'new-key',
    })),
    deleteOrganization: jest.fn<(...args: any[]) => Promise<any>>(async () => ({
      channels: 2,
      posts: 3,
    })),
    upsertMember: jest.fn<(...args: any[]) => Promise<any>>(
      async (_org: string, _user: string, role: string) => ({ role })
    ),
    removeMember: jest.fn<(...args: any[]) => Promise<any>>(async () => 1),
  };
  const users = { getUserByEmail: jest.fn<(...args: any[]) => Promise<any>>() };
  // Built untyped: other PRs add constructor arguments these routes never use.
  const controller = new (AdminProvisionController as any)(
    organizations,
    users,
    {},
    {}
  );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POSTIZ_ADMIN_TOKEN = token;
    organizations.getOrgById.mockResolvedValue(live);
  });

  const routes = (t: string, id: string) => [
    () => controller.disableOrganization(t, id),
    () => controller.enableOrganization(t, id),
    () => controller.rotateApiKey(t, id),
    () => controller.deleteOrganization(t, id),
  ];
  const writes = () =>
    organizations.setDisabled.mock.calls.length +
    organizations.updateApiKey.mock.calls.length +
    organizations.deleteOrganization.mock.calls.length;

  it('every route needs the admin token', async () => {
    for (const bad of ['', 'wrong'])
      for (const call of routes(bad, 'org-1'))
        await expect(call()).rejects.toMatchObject({ status: 401 });
    delete process.env.POSTIZ_ADMIN_TOKEN;
    for (const call of routes('', 'org-1'))
      await expect(call()).rejects.toMatchObject({ status: 401 });
    expect(writes()).toBe(0);
  });

  it('unknown org is 404, deleted org is 409, with no write', async () => {
    organizations.getOrgById.mockResolvedValue(null);
    for (const call of routes(token, 'missing'))
      await expect(call()).rejects.toMatchObject({ status: 404 });
    organizations.getOrgById.mockResolvedValue({ ...live, deletedAt: new Date() });
    for (const call of routes(token, 'org-1'))
      await expect(call()).rejects.toMatchObject({ status: 409 });
    expect(writes()).toBe(0);
  });

  it('disable, enable, rotate and delete', async () => {
    await expect(controller.disableOrganization(token, 'org-1')).resolves.toEqual({
      organizationId: 'org-1',
      disabled: true,
    });
    expect(organizations.setDisabled).toHaveBeenLastCalledWith('org-1', true);
    await expect(controller.enableOrganization(token, 'org-1')).resolves.toEqual({
      organizationId: 'org-1',
      disabled: false,
    });
    expect(organizations.setDisabled).toHaveBeenLastCalledWith('org-1', false);
    await expect(controller.rotateApiKey(token, 'org-1')).resolves.toEqual({
      organizationId: 'org-1',
      apiKey: 'new-key',
    });
    await expect(controller.deleteOrganization(token, 'org-1')).resolves.toEqual({
      organizationId: 'org-1',
      deleted: true,
      channels: 2,
      posts: 3,
    });
  });

  it('provisioning the email of a deleted org is a 409, not its dead key', async () => {
    users.getUserByEmail.mockResolvedValue({ id: 'user-1' });
    organizations.getOrgsByUserId.mockResolvedValue([{ id: 'org-1' }]);
    organizations.getOrgById.mockResolvedValue({ ...live, apiKey: null, deletedAt: new Date() });
    await expect(
      controller.createOrganization(token, {
        name: 'Tenant',
        email: 'tenant@app-one.example.com',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  describe('remove member', () => {
    it('needs the admin token; unknown org is 404', async () => {
      await expect(controller.removeMember('wrong', 'org-1', { email: 'op@x.io' })).rejects.toMatchObject({
        status: 401,
      });
      organizations.getOrgById.mockResolvedValue(null);
      await expect(controller.removeMember(token, 'missing', { email: 'op@x.io' })).rejects.toMatchObject({
        status: 404,
      });
      expect(organizations.removeMember).not.toHaveBeenCalled();
    });

    it('removes the login, also from a deleted org; unknown login removes nothing', async () => {
      users.getUserByEmail.mockResolvedValue({ id: 'user-op' });
      organizations.getOrgById.mockResolvedValue({ ...live, deletedAt: new Date() });
      await expect(controller.removeMember(token, 'org-1', { email: 'op@x.io' })).resolves.toEqual({
        organizationId: 'org-1',
        removed: 1,
      });
      expect(organizations.removeMember).toHaveBeenLastCalledWith('org-1', 'user-op');
      users.getUserByEmail.mockResolvedValue(null);
      organizations.removeMember.mockClear();
      await expect(controller.removeMember(token, 'org-1', { email: 'nobody@x.io' })).resolves.toEqual({
        organizationId: 'org-1',
        removed: 0,
      });
      expect(organizations.removeMember).not.toHaveBeenCalled();
    });
  });

  describe('add member', () => {
    const add = (t: string, id: string, body: any) =>
      controller.addMember(t, id, body);

    it('needs the admin token and a live org, with no write', async () => {
      for (const bad of ['', 'wrong'])
        await expect(add(bad, 'org-1', { email: 'op@x.io' })).rejects.toMatchObject({
          status: 401,
        });
      organizations.getOrgById.mockResolvedValue(null);
      await expect(add(token, 'missing', { email: 'op@x.io' })).rejects.toMatchObject({
        status: 404,
      });
      organizations.getOrgById.mockResolvedValue({ ...live, deletedAt: new Date() });
      await expect(add(token, 'org-1', { email: 'op@x.io' })).rejects.toMatchObject({
        status: 409,
      });
      expect(organizations.upsertMember).not.toHaveBeenCalled();
    });

    it('an unknown login is 404 and creates nothing', async () => {
      users.getUserByEmail.mockResolvedValue(null);
      await expect(add(token, 'org-1', { email: 'nobody@x.io' })).rejects.toMatchObject({
        status: 404,
      });
      expect(organizations.upsertMember).not.toHaveBeenCalled();
    });

    it('adds the login as ADMIN by default, or the given role', async () => {
      users.getUserByEmail.mockResolvedValue({ id: 'user-op' });
      await expect(add(token, 'org-1', { email: 'op@x.io' })).resolves.toEqual({
        organizationId: 'org-1',
        userId: 'user-op',
        role: 'ADMIN',
      });
      expect(organizations.upsertMember).toHaveBeenLastCalledWith(
        'org-1',
        'user-op',
        'ADMIN'
      );
      await add(token, 'org-1', { email: 'op@x.io', role: 'USER' });
      expect(organizations.upsertMember).toHaveBeenLastCalledWith(
        'org-1',
        'user-op',
        'USER'
      );
    });
  });
});

describe('a disabled org is refused everywhere a tenant reaches it', () => {
  const disabledOrg = {
    id: 'org-off',
    disabledAt: new Date() as Date | null,
    subscription: null as unknown,
  };
  const response = () => {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  it('public API: API key and OAuth token both get 403', async () => {
    const middleware = new PublicAuthMiddleware(
      { getOrgByApiKey: async () => disabledOrg } as any,
      { getOrgByOAuthToken: async () => ({ organization: disabledOrg }) } as any
    );
    for (const authorization of ['org-key', 'pos_token']) {
      const res = response();
      const next = jest.fn();
      await middleware.use({ headers: { authorization } } as any, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }

    const res = response();
    const next = jest.fn();
    await new PublicAuthMiddleware(
      { getOrgByApiKey: async () => ({ ...disabledOrg, disabledAt: null as Date | null }) } as any,
      {} as any
    ).use({ headers: { authorization: 'org-key' } } as any, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('connect links: listing and starting a connection get 403', async () => {
    const links = new ConnectLinkController(
      {
        getAllIntegrations: async () => ({ social: [] as any[] }),
        getAllowedSocialsIntegrations: () => ['x'],
      } as any,
      { getOrgById: async () => disabledOrg } as any,
      {} as any
    );
    await expect(links.getAvailableIntegrations('link-token')).rejects.toMatchObject({
      status: 403,
    });
    await expect(links.getOAuthUrl('link-token', 'x')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('posting: the activity returns no post for a disabled org', async () => {
    const { PostActivity } = await import(
      '../../../../orchestrator/src/activities/post.activity'
    );
    const posts = {
      getPostById: jest.fn(),
      getPostsRecursively: jest.fn(),
    };
    const activity = new PostActivity(
      posts as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getOrgById: async () => disabledOrg } as any
    );
    await expect(activity.getPostsList('org-off', 'post-1')).resolves.toEqual([]);
    await expect(activity.getPost('org-off', 'post-1')).resolves.toBe(false);
    expect(posts.getPostsRecursively).not.toHaveBeenCalled();
    expect(posts.getPostById).not.toHaveBeenCalled();
  });
});
