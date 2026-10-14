/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { IntegrationRepository } from './integration.repository';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ uploadSimple: jest.fn() }) },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
}));

describe('page selection persistence', () => {
  const integration = {
    findUnique: jest.fn<(...args: any[]) => Promise<any>>(),
    update: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const post = { updateMany: jest.fn<(...args: any[]) => Promise<any>>() };
  const repository = new IntegrationRepository(
    { model: { integration } } as any,
    { model: { post } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const params = {
    organizationId: 'connect-org',
    internalId: 'selected-page',
    name: 'Cloudeefy',
    inBetweenSteps: false,
  };
  beforeEach(() => {
    jest.clearAllMocks();
    integration.update.mockResolvedValue({ id: 'saved' });
  });

  it('reconnecting the same page preserves its publications and identifier', async () => {
    integration.findUnique.mockResolvedValue({ id: 'current' });
    await repository.updateIntegration('current', { ...params });
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(integration.update).toHaveBeenCalledTimes(1);
    expect(integration.update).toHaveBeenCalledWith({
      where: { id: 'current' },
      data: { ...params, disabled: false, deletedAt: null },
    });
  });

  it('reuses the existing page identity without deleting its publication history', async () => {
    integration.findUnique.mockResolvedValue({ id: 'existing-page' });
    await repository.updateIntegration('pending', { ...params });
    expect(integration.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_internalId: {
          organizationId: 'connect-org',
          internalId: 'selected-page',
        },
      },
    });
    expect(post.updateMany).toHaveBeenCalledWith({
      where: { integrationId: 'pending' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(integration.update).toHaveBeenLastCalledWith({
      where: { id: 'existing-page' },
      data: { ...params, disabled: false, deletedAt: null },
    });
  });

  it('finalizes a new page without deleting any publications', async () => {
    integration.findUnique.mockResolvedValue(null);
    await repository.updateIntegration('pending', { ...params });
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(integration.update).toHaveBeenCalledTimes(1);
    expect(integration.update).toHaveBeenCalledWith({
      where: { id: 'pending' },
      data: { ...params, disabled: false, deletedAt: null },
    });
  });
});
