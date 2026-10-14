/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { IntegrationRepository } from './integration.repository';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ uploadSimple: jest.fn() }) },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
  PrismaTransaction: class {},
}));

describe('page selection persistence', () => {
  const integration = {
    findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
    findUnique: jest.fn<(...args: any[]) => Promise<any>>(),
    upsert: jest.fn<(...args: any[]) => Promise<any>>(),
    update: jest.fn<(...args: any[]) => Promise<any>>(),
    updateMany: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const post = { updateMany: jest.fn() };
  const transaction = jest.fn(async (run: any) => run({ integration }));
  const repository = new IntegrationRepository(
    { model: { integration } } as any,
    { model: { post } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { model: { $transaction: transaction } } as any
  );
  const params = {
    organizationId: 'connect-org',
    internalId: 'page-B',
    name: 'Page B',
    inBetweenSteps: false,
    token: 'new-token',
  };
  beforeEach(() => {
    jest.clearAllMocks();
    integration.findFirst.mockResolvedValue({
      id: 'draft',
      internalId: 'pending:linkedin-page:test',
      providerIdentifier: 'linkedin-page',
      inBetweenSteps: true,
    });
    integration.findUnique.mockResolvedValue(null);
    integration.update.mockResolvedValue({ id: 'saved', ...params });
  });

  it('uses an isolated draft key without upserting the first real page', async () => {
    integration.upsert.mockImplementation(async (args: any) => args.create);
    const first = await repository.createOrUpdateIntegration(
      undefined,
      true,
      'connect-org',
      'Page A',
      undefined,
      'social',
      'page-A',
      'linkedin-page',
      'new-token',
      'new-refresh',
      3600,
      undefined,
      true
    );
    const second = await repository.createOrUpdateIntegration(
      undefined,
      true,
      'connect-org',
      'Page A',
      undefined,
      'social',
      'page-A',
      'linkedin-page',
      'new-token',
      'new-refresh',
      3600,
      undefined,
      true
    );
    expect(first.internalId).toMatch(/^pending:linkedin-page:/);
    expect(first.internalId).not.toBe(second.internalId);
    expect(first.rootInternalId).toBe('page-A');
    expect(
      integration.upsert.mock.calls[0][0].where.organizationId_internalId
        .internalId
    ).toBe(first.internalId);
    expect(integration.updateMany).not.toHaveBeenCalled();
  });

  it('reconnects the same legacy page without touching its publications', async () => {
    integration.findFirst.mockResolvedValue({
      id: 'current',
      internalId: 'page-B',
      providerIdentifier: 'linkedin-page',
      inBetweenSteps: true,
    });
    integration.findUnique.mockResolvedValue({
      id: 'current',
      providerIdentifier: 'linkedin-page',
    });
    await repository.updateIntegration('current', { ...params });
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(integration.update).toHaveBeenCalledTimes(1);
    expect(integration.update).toHaveBeenCalledWith({
      where: { id: 'current', organizationId: 'connect-org' },
      data: {
        ...params,
        disabled: false,
        deletedAt: null,
        refreshNeeded: false,
      },
    });
  });

  it('updates an existing B and retires only the draft without deleting posts', async () => {
    integration.findUnique.mockResolvedValue({
      id: 'existing-B',
      providerIdentifier: 'linkedin-page',
    });
    await repository.updateIntegration('draft', { ...params });
    expect(integration.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'existing-B', organizationId: 'connect-org' },
      data: {
        ...params,
        disabled: false,
        deletedAt: null,
        refreshNeeded: false,
      },
    });
    expect(integration.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'draft', organizationId: 'connect-org' },
      data: {
        deletedAt: expect.any(Date),
        token: '',
        refreshToken: null,
        tokenExpiration: null,
      },
    });
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('finalizes a new B on the draft ID without modifying page A', async () => {
    await repository.updateIntegration('draft', { ...params });
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(integration.update).toHaveBeenCalledTimes(1);
    expect(integration.update.mock.calls[0][0].where).toEqual({
      id: 'draft',
      organizationId: 'connect-org',
    });
  });

  it('rejects legacy A to B selection rather than renaming an existing page', async () => {
    integration.findFirst.mockResolvedValue({
      id: 'legacy-A',
      internalId: 'page-A',
      providerIdentifier: 'linkedin-page',
      inBetweenSteps: true,
    });
    await expect(
      repository.updateIntegration('legacy-A', { ...params })
    ).rejects.toMatchObject({ status: 409 });
    expect(integration.update).not.toHaveBeenCalled();
    expect(post.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a draft from another organization before any write', async () => {
    integration.findFirst.mockResolvedValue(null);
    await expect(
      repository.updateIntegration('foreign-draft', { ...params })
    ).rejects.toMatchObject({ status: 404 });
    expect(integration.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'foreign-draft',
        organizationId: 'connect-org',
        deletedAt: null,
      },
    });
    expect(integration.update).not.toHaveBeenCalled();
  });

  it('refuses an existing identity belonging to another provider', async () => {
    integration.findUnique.mockResolvedValue({
      id: 'other-provider',
      providerIdentifier: 'linkedin',
    });
    await expect(
      repository.updateIntegration('draft', { ...params })
    ).rejects.toMatchObject({ status: 409 });
    expect(integration.update).not.toHaveBeenCalled();
  });
});
