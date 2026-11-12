/** @jest-environment node */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { PostsRepository } from './posts.repository';

// This suite may only mutate an explicitly configured disposable loopback DB.
const databaseUrl = process.env.POSTIZ_CONNECT_TEST_DATABASE_URL;
if (databaseUrl) {
  const target = new URL(databaseUrl);
  if (
    target.hostname !== '127.0.0.1' ||
    target.pathname !== '/postiz_connect_test'
  ) {
    throw new Error('Post scope tests require loopback /postiz_connect_test');
  }
}

const integrationTests = databaseUrl ? describe : describe.skip;
integrationTests('post writes stay inside the caller org', () => {
  let db: PrismaClient;
  let repository: PostsRepository;
  const orgA = 'scope-org-a';
  const orgB = 'scope-org-b';
  const channelA = 'scope-channel-a';
  const channelB = 'scope-channel-b';

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
    const model = { model: db } as any;
    repository = new PostsRepository(model, model, model, model, model, model);
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
        { id: orgA, name: 'A' },
        { id: orgB, name: 'B' },
      ],
    });
    for (const [id, organizationId] of [
      [channelA, orgA],
      [channelB, orgB],
    ]) {
      await db.integration.create({
        data: {
          id,
          internalId: id,
          rootInternalId: id,
          organizationId,
          name: id,
          providerIdentifier: 'x',
          type: 'social',
          token: 'token',
        },
      });
    }
  });

  const save = (orgId: string, channel: string, extra: any) =>
    repository.createOrUpdatePost(
      'schedule',
      orgId,
      '2030-01-01T10:00:00.000Z',
      {
        integration: { id: channel },
        settings: {},
        ...extra,
        value: extra.value || [{ content: 'new', image: [] }],
      } as any,
      []
    );

  it('a post id from another org creates a new post and leaves the other one alone', async () => {
    const { posts } = await save(orgB, channelB, {
      value: [{ content: 'B original', image: [] }],
    });
    const victim = posts[0];

    const { posts: attack } = await save(orgA, channelA, {
      value: [{ id: victim.id, content: 'A takeover', image: [] }],
    });

    expect(attack[0].id).not.toBe(victim.id);
    expect(attack[0].organizationId).toBe(orgA);
    const after = await db.post.findUnique({ where: { id: victim.id } });
    expect(after).toMatchObject({
      organizationId: orgB,
      integrationId: channelB,
      content: 'B original',
      group: victim.group,
      deletedAt: null,
    });
  });

  it('a group from another org does not delete that org posts', async () => {
    const { posts } = await save(orgB, channelB, {
      value: [{ content: 'B scheduled', image: [] }],
    });
    const victim = posts[0];

    const { previousPost } = await save(orgA, channelA, {
      group: victim.group,
    });

    expect(previousPost).toBeUndefined();
    const after = await db.post.findUnique({ where: { id: victim.id } });
    expect(after?.deletedAt).toBeNull();
  });

  it('still updates and regroups a post of the same org', async () => {
    const { posts } = await save(orgA, channelA, {
      value: [{ content: 'first', image: [] }],
    });
    const own = posts[0];

    const { posts: edited } = await save(orgA, channelA, {
      group: own.group,
      value: [{ id: own.id, content: 'edited', image: [] }],
    });

    expect(edited[0].id).toBe(own.id);
    expect(edited[0].content).toBe('edited');
    expect(edited[0].deletedAt).toBeNull();
  });
});
