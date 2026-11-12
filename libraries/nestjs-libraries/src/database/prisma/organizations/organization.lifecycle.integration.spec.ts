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
import { OrganizationRepository } from './organization.repository';

jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { fixedEncryption: (value: string) => value },
}));

// This suite may only mutate an explicitly configured disposable loopback DB.
const databaseUrl = process.env.POSTIZ_CONNECT_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (
    target.hostname !== '127.0.0.1' ||
    target.pathname !== '/postiz_connect_test'
  ) {
    throw new Error('Lifecycle tests require loopback /postiz_connect_test');
  }
}

const integrationTests = databaseUrl ? describe : describe.skip;
integrationTests('admin org lifecycle against PostgreSQL', () => {
  let db: PrismaClient;
  let repository: OrganizationRepository;
  const orgs = ['life-org-a', 'life-org-b'];

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const model = { model: db } as any;
    repository = new OrganizationRepository(model, model, model, model);
  });
  const cleanUp = async () => {
    await db.oAuthAuthorization.deleteMany();
    await db.oAuthApp.deleteMany();
    await db.post.deleteMany();
    await db.integration.deleteMany();
    await db.organization.deleteMany();
    await db.user.deleteMany({ where: { email: 'life@app-one.example.com' } });
  };
  afterAll(async () => {
    // Other suites delete organizations; leave no OAuth rows pointing at them.
    if (db) await cleanUp();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await cleanUp();
    const user = await db.user.create({
      data: {
        email: 'life@app-one.example.com',
        providerName: 'LOCAL',
        timezone: 0,
      },
    });
    for (const id of orgs) {
      await db.organization.create({
        data: { id, name: id, apiKey: `key-${id}` },
      });
      for (const n of [1, 2]) {
        const channel = await db.integration.create({
          data: {
            id: `${id}-ch${n}`,
            internalId: `${id}-ch${n}`,
            rootInternalId: `${id}-ch${n}`,
            organizationId: id,
            name: 'channel',
            providerIdentifier: 'x',
            type: 'social',
            token: 'secret-token',
            refreshToken: 'secret-refresh',
          },
        });
        if (n === 1) {
          for (const state of ['QUEUE', 'DRAFT', 'PUBLISHED'] as const) {
            await db.post.create({
              data: {
                id: `${id}-${state}`,
                organizationId: id,
                integrationId: channel.id,
                state,
                publishDate: new Date('2030-01-01T10:00:00Z'),
                content: 'post',
                group: `${id}-group`,
              },
            });
          }
        }
      }
      const app = await db.oAuthApp.create({
        data: {
          organizationId: id,
          name: 'app',
          redirectUrl: 'https://app-one.example.com/callback',
          clientId: `client-${id}`,
          clientSecret: 'secret',
        },
      });
      await db.oAuthAuthorization.create({
        data: {
          oauthAppId: app.id,
          userId: user.id,
          organizationId: id,
          accessToken: `pos_${id}`,
        },
      });
    }
  });

  it('disable and enable only toggle disabledAt', async () => {
    await repository.setDisabled('life-org-a', true);
    const disabled = await db.organization.findUniqueOrThrow({
      where: { id: 'life-org-a' },
    });
    expect(disabled.disabledAt).toBeInstanceOf(Date);
    expect(disabled.apiKey).toBe('key-life-org-a');
    expect(await db.integration.count({ where: { deletedAt: null } })).toBe(4);

    await repository.setDisabled('life-org-a', false);
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: 'life-org-a' } }))
        .disabledAt
    ).toBeNull();
  });

  it('delete revokes access, removes channels and their tokens, drops unpublished posts', async () => {
    await expect(repository.deleteOrganization('life-org-a')).resolves.toEqual({
      channels: 2,
      posts: 2,
    });

    const org = await db.organization.findUniqueOrThrow({
      where: { id: 'life-org-a' },
    });
    expect(org).toMatchObject({ apiKey: null });
    expect(org.disabledAt).toBeInstanceOf(Date);
    expect(org.deletedAt).toBeInstanceOf(Date);
    expect(await repository.getOrgByApiKey('key-life-org-a')).toBeNull();

    const channels = await db.integration.findMany({
      where: { organizationId: 'life-org-a' },
    });
    for (const channel of channels) {
      expect(channel).toMatchObject({
        disabled: true,
        token: '',
        refreshToken: null,
      });
      expect(channel.deletedAt).toBeInstanceOf(Date);
    }

    const posts = await db.post.findMany({
      where: { organizationId: 'life-org-a' },
      orderBy: { id: 'asc' },
    });
    expect(posts.map((p) => [p.state, !!p.deletedAt])).toEqual([
      ['DRAFT', true],
      ['PUBLISHED', false],
      ['QUEUE', true],
    ]);

    const auth = await db.oAuthAuthorization.findFirstOrThrow({
      where: { organizationId: 'life-org-a' },
    });
    expect(auth.accessToken).toBeNull();
    expect(auth.revokedAt).toBeInstanceOf(Date);
  });

  it('delete leaves every other org untouched', async () => {
    const before = {
      org: await db.organization.findUniqueOrThrow({
        where: { id: 'life-org-b' },
      }),
      channels: await db.integration.findMany({
        where: { organizationId: 'life-org-b' },
      }),
      posts: await db.post.findMany({
        where: { organizationId: 'life-org-b' },
      }),
      auth: await db.oAuthAuthorization.findMany({
        where: { organizationId: 'life-org-b' },
      }),
    };
    await repository.deleteOrganization('life-org-a');
    expect({
      org: await db.organization.findUniqueOrThrow({
        where: { id: 'life-org-b' },
      }),
      channels: await db.integration.findMany({
        where: { organizationId: 'life-org-b' },
      }),
      posts: await db.post.findMany({
        where: { organizationId: 'life-org-b' },
      }),
      auth: await db.oAuthAuthorization.findMany({
        where: { organizationId: 'life-org-b' },
      }),
    }).toEqual(before);
  });
});
