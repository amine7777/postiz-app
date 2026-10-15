/** @jest-environment node */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { IntegrationRepository } from './integration.repository';
import { IntegrationService } from './integration.service';
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ uploadSimple: async (url: string) => url }),
  },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository',
  () => ({ AutopostRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), del: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class {},
  NotEnoughScopes: class {},
  ProviderConnectionError: class ProviderConnectionError extends Error {
    constructor(public stage: string, public status?: number) { super('Social provider connection failed'); }
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service',
  () => ({ ProviderCredentialService: class {} })
);
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/integration.missing.scopes',
  () => ({
    NotEnoughScopesFilter: class {
      catch() {}
    },
  })
);
jest.mock(
  '@gitroom/backend/services/auth/permissions/permissions.ability',
  () => ({ CheckPolicies: () => () => undefined })
);

// This suite may only mutate an explicitly configured disposable loopback DB.
const databaseUrl = process.env.POSTIZ_CONNECT_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (
    target.hostname !== '127.0.0.1' ||
    target.pathname !== '/postiz_connect_test'
  ) {
    throw new Error(
      'Connection integration tests require loopback /postiz_connect_test'
    );
  }
}
const integrationTests = databaseUrl ? describe : describe.skip;
integrationTests('page connection against PostgreSQL', () => {
  let db: PrismaClient;
  let repository: IntegrationRepository;
  let service: IntegrationService;
  let controller: NoAuthIntegrationsController;
  const startRefreshWorkflow = jest.fn<(...args: any[]) => Promise<any>>();
  const fetchPageInformation = jest.fn<(...args: any[]) => Promise<any>>();
  const org = 'connect-test-org';
  const foreignOrg = 'foreign-test-org';
  const provider = {
    identifier: 'linkedin-page',
    oneTimeToken: true,
    fetchPageInformation,
  };

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    repository = new IntegrationRepository(
      { model: db } as any,
      { model: db } as any,
      { model: db } as any,
      { model: db } as any,
      { model: db } as any,
      { model: db } as any,
      { model: db } as any
    );
    const manager = { getSocialIntegration: () => provider };
    service = new IntegrationService(
      repository,
      {} as any,
      manager as any,
      {} as any,
      { startRefreshWorkflow } as any,
      {} as any
    );
    controller = new NoAuthIntegrationsController(
      manager as any,
      service,
      { startRefreshWorkflow } as any,
      {
        getOrgById: (id: string) =>
          db.organization.findUnique({ where: { id } }),
      } as any,
      {} as any
    );
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  beforeEach(async () => {
    await db.post.deleteMany();
    await db.integration.deleteMany();
    await db.organization.deleteMany();
    await db.organization.createMany({
      data: [
        { id: org, name: 'Test' },
        { id: foreignOrg, name: 'Foreign' },
      ],
    });
    jest.clearAllMocks();
    startRefreshWorkflow.mockResolvedValue(true);
    fetchPageInformation.mockImplementation(
      async (_token: string, data: { page: string }) => ({
        id: data.page,
        name: data.page,
        access_token: 'selected-token',
        username: 'page-profile',
      })
    );
    (ioRedis.get as jest.Mock<any>).mockImplementation(async (key: string) =>
      key === 'organization:test-state' ? org : null
    );
  });
  async function page(
    internalId: string,
    organizationId = org,
    inBetweenSteps = false
  ) {
    return db.integration.create({
      data: {
        internalId,
        organizationId,
        name: internalId,
        providerIdentifier: 'linkedin-page',
        type: 'social',
        token: 'old-token',
        rootInternalId: 'A',
        refreshToken: 'old-refresh',
        inBetweenSteps,
      },
    });
  }
  async function posts(integrationId: string) {
    return Promise.all(
      ['PUBLISHED', 'QUEUE'].map((state) =>
        db.post.create({
          data: {
            integrationId,
            organizationId: org,
            state: state as any,
            publishDate: new Date('2030-01-01T12:00:00Z'),
            content: 'test',
            group: 'test-group',
          },
        })
      )
    );
  }
  async function draft() {
    return repository.createOrUpdateIntegration(
      undefined,
      true,
      org,
      'A',
      undefined,
      'social',
      'A',
      'linkedin-page',
      'oauth-token',
      'new-refresh',
      3600,
      undefined,
      true
    );
  }
  async function assertPostsUnchanged(before: any[]) {
    for (const post of before)
      expect(await db.post.findUnique({ where: { id: post.id } })).toEqual(
        post
      );
  }

  it('A -> new B leaves active A and its scheduled/history posts unchanged', async () => {
    const a = await page('A');
    const history = await posts(a.id);
    const pending = await draft();
    expect(pending.internalId).toMatch(/^pending:linkedin-page:/);
    expect(await db.integration.findUnique({ where: { id: a.id } })).toEqual(a);
    const saved = await controller.saveProviderPage(pending.id, {
      state: 'test-state',
      page: 'B',
    });
    expect(saved).toMatchObject({ success: true, id: pending.id });
    const b = await db.integration.findUniqueOrThrow({
      where: { id: pending.id },
    });
    expect(b).toMatchObject({
      internalId: 'B',
      inBetweenSteps: false,
      refreshToken: 'new-refresh',
      rootInternalId: 'A',
    });
    const afterA = await db.integration.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(afterA).toMatchObject({
      internalId: 'A',
      inBetweenSteps: false,
      deletedAt: null,
    });
    await assertPostsUnchanged(history);
    expect(startRefreshWorkflow).toHaveBeenCalledWith(org, b.id, provider);
  });

  it('A -> existing B retains both real IDs, customers and all posts', async () => {
    const a = await page('A');
    const b = await page('B');
    const history = [...(await posts(a.id)), ...(await posts(b.id))];
    const pending = await draft();
    const saved = await controller.saveProviderPage(pending.id, {
      state: 'test-state',
      page: 'B',
    });
    expect(saved).toMatchObject({ success: true, id: b.id });
    expect(
      await db.integration.findUniqueOrThrow({ where: { id: b.id } })
    ).toMatchObject({
      internalId: 'B',
      token: 'selected-token',
      refreshToken: 'new-refresh',
      deletedAt: null,
      inBetweenSteps: false,
    });
    expect(
      await db.integration.findUniqueOrThrow({ where: { id: a.id } })
    ).toMatchObject({
      internalId: 'A',
      deletedAt: null,
      inBetweenSteps: false,
    });
    expect(
      await db.integration.findUniqueOrThrow({ where: { id: pending.id } })
    ).toMatchObject({
      deletedAt: expect.any(Date),
      token: '',
      refreshToken: null,
    });
    await assertPostsUnchanged(history);
    expect(startRefreshWorkflow).toHaveBeenCalledWith(org, b.id, provider);
  });

  it('reconnecting A preserves A ID and posts and retires only the draft', async () => {
    const a = await page('A');
    const history = await posts(a.id);
    const pending = await draft();
    expect(
      await controller.saveProviderPage(pending.id, {
        state: 'test-state',
        page: 'A',
      })
    ).toMatchObject({ id: a.id });
    await assertPostsUnchanged(history);
    expect(
      await db.integration.findUniqueOrThrow({ where: { id: a.id } })
    ).toMatchObject({
      internalId: 'A',
      deletedAt: null,
      token: 'selected-token',
    });
  });

  it('state from org cannot save a foreign integration or call its provider', async () => {
    const foreign = await page('foreign', foreignOrg, true);
    await expect(
      controller.saveProviderPage(foreign.id, {
        state: 'test-state',
        page: 'B',
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchPageInformation).not.toHaveBeenCalled();
    expect(
      await db.integration.findUnique({ where: { id: foreign.id } })
    ).toEqual(foreign);
  });

  it('token propagation does not update another organization with the same root', async () => {
    const foreign = await page('A', foreignOrg);
    const pending = await draft();
    await controller.saveProviderPage(pending.id, {
      state: 'test-state',
      page: 'B',
    });
    expect(
      await db.integration.findUnique({ where: { id: foreign.id } })
    ).toEqual(foreign);
  });

  it('page credentials never overwrite the separate personal LinkedIn provider', async () => {
    const personal = await page('personal-user');
    const original = await db.integration.update({
      where: { id: personal.id },
      data: { providerIdentifier: 'linkedin' },
    });
    const pending = await draft();
    await controller.saveProviderPage(pending.id, {
      state: 'test-state',
      page: 'B',
    });
    expect(
      await db.integration.findUnique({ where: { id: personal.id } })
    ).toEqual(original);
  });

  it('concurrent selections keep the existing target identity and post history', async () => {
    const a = await page('A');
    const b = await page('B');
    const history = [...(await posts(a.id)), ...(await posts(b.id))];
    const drafts = [await draft(), await draft()];
    const attempts = await Promise.allSettled(
      drafts.map((pending) =>
        controller.saveProviderPage(pending.id, {
          state: 'test-state',
          page: 'B',
        })
      )
    );
    expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(
      true
    );
    const target = await db.integration.findUniqueOrThrow({
      where: { id: b.id },
    });
    expect(target).toMatchObject({
      internalId: 'B',
      deletedAt: null,
      inBetweenSteps: false,
    });
    expect(
      await db.integration.count({
        where: { organizationId: org, internalId: 'B' },
      })
    ).toBe(1);
    await assertPostsUnchanged(history);
  });

  it('legacy A -> B callbacks fail without altering either page or publications', async () => {
    const a = await page('A', org, true);
    const b = await page('B');
    const history = [...(await posts(a.id)), ...(await posts(b.id))];
    await expect(
      controller.saveProviderPage(a.id, { state: 'test-state', page: 'B' })
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.integration.findUnique({ where: { id: a.id } })).toEqual(a);
    expect(await db.integration.findUnique({ where: { id: b.id } })).toEqual(b);
    await assertPostsUnchanged(history);
  });

  it('public/quota lists hide abandoned drafts and expose only completed pages', async () => {
    const a = await page('A');
    const abandoned = await draft();
    const selected = await draft();
    expect(
      (await service.getIntegrationsList(org)).map((row) => row.id)
    ).toEqual([a.id]);
    expect(
      (await service.getIntegrationsList(org, true)).map((row) => row.id)
    ).toEqual(expect.arrayContaining([a.id, abandoned.id, selected.id]));
    await controller.saveProviderPage(selected.id, {
      state: 'test-state',
      page: 'B',
    });
    const connected = await service.getIntegrationsList(org);
    expect(connected.map((row) => row.internalId).sort()).toEqual(['A', 'B']);
    expect(connected.some((row) => row.id === abandoned.id)).toBe(false);
  });

  it('rejects malformed provider responses before any identity write', async () => {
    const pending = await draft();
    fetchPageInformation.mockResolvedValueOnce({
      name: 'missing-id',
      access_token: 'bad',
    });
    await expect(
      controller.saveProviderPage(pending.id, {
        state: 'test-state',
        page: 'B',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await db.integration.findUnique({ where: { id: pending.id } })
    ).toEqual(pending);
    expect(startRefreshWorkflow).not.toHaveBeenCalled();
  });

  it('rolls back the selected-page update if retirement fails', async () => {
    const b = await page('B');
    const pending = await draft();
    const broken = new IntegrationRepository(
      { model: db } as any,
      { model: db } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        model: {
          $transaction: (run: any, options: any) =>
            db.$transaction(async (tx) => {
              let writes = 0;
              return run({
                integration: {
                  findFirst: tx.integration.findFirst.bind(tx.integration),
                  findUnique: tx.integration.findUnique.bind(tx.integration),
                  update: (args: any) => {
                    if (++writes === 2)
                      throw new Error('simulated retirement failure');
                    return tx.integration.update(args);
                  },
                },
              });
            }, options),
        },
      } as any
    );
    await expect(
      broken.updateIntegration(pending.id, {
        organizationId: org,
        internalId: 'B',
        token: 'replacement',
        inBetweenSteps: false,
      })
    ).rejects.toThrow('simulated retirement failure');
    expect(await db.integration.findUnique({ where: { id: b.id } })).toEqual(b);
    expect(
      await db.integration.findUnique({ where: { id: pending.id } })
    ).toEqual(pending);
  });
});
