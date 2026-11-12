/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

import { AdminProvisionController } from './admin.provision.controller';

describe('admin provisioning: channel limits', () => {
  const organizations = {
    getOrgById: jest.fn<(...args: any[]) => Promise<any>>(),
    getOrgsByUserId: jest.fn<(...args: any[]) => Promise<any>>(),
    createOrgAndUser: jest.fn<(...args: any[]) => Promise<any>>(),
    setChannelLimits: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const users = {
    getUserByEmail: jest.fn<(...args: any[]) => Promise<any>>(),
    activateUser: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const integrations = {
    applyChannelLimits: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const manager = { getAllowedSocialsIntegrations: () => ['youtube', 'x'] };
  const controller = new AdminProvisionController(
    organizations as any,
    users as any,
    integrations as any,
    manager as any
  );
  const token = 'admin-secret';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POSTIZ_ADMIN_TOKEN = token;
    organizations.getOrgById.mockResolvedValue({ id: 'org-1', apiKey: 'key' });
    organizations.setChannelLimits.mockImplementation(
      async (id: string, channelLimits: any) => ({ id, channelLimits })
    );
    integrations.applyChannelLimits.mockResolvedValue({ disabled: ['newest'], enabled: [] });
    users.getUserByEmail.mockResolvedValue(null);
    organizations.createOrgAndUser.mockResolvedValue({
      id: 'org-new',
      users: [{ user: { id: 'user-1' } }],
    });
  });

  it('PATCH needs the admin token', async () => {
    for (const bad of ['', 'wrong']) {
      await expect(
        controller.updateOrganization(bad, 'org-1', { channelLimits: { x: 1 } })
      ).rejects.toMatchObject({ status: 401 });
    }
    delete process.env.POSTIZ_ADMIN_TOKEN;
    await expect(
      controller.updateOrganization('', 'org-1', { channelLimits: { x: 1 } })
    ).rejects.toMatchObject({ status: 401 });
    expect(organizations.setChannelLimits).not.toHaveBeenCalled();
  });

  it('PATCH saves the limits and disables channels over them', async () => {
    await expect(
      controller.updateOrganization(token, 'org-1', {
        channelLimits: { youtube: 2, x: 1 },
      })
    ).resolves.toEqual({
      organizationId: 'org-1',
      channelLimits: { youtube: 2, x: 1 },
      disabledChannels: ['newest'],
      enabledChannels: [],
    });
    expect(integrations.applyChannelLimits).toHaveBeenCalledWith('org-1', {
      youtube: 2,
      x: 1,
    });
  });

  it('PATCH null clears the limits and gives back what they had paused', async () => {
    integrations.applyChannelLimits.mockResolvedValue({ disabled: [], enabled: ['parked'] });
    await expect(
      controller.updateOrganization(token, 'org-1', { channelLimits: null })
    ).resolves.toEqual({
      organizationId: 'org-1',
      channelLimits: null,
      disabledChannels: [],
      enabledChannels: ['parked'],
    });
    expect(integrations.applyChannelLimits).toHaveBeenCalledWith('org-1', null);
  });

  it('PATCH refuses bad limits and unknown orgs before any write', async () => {
    await expect(
      controller.updateOrganization(token, 'org-1', {
        channelLimits: { myspace: 1 },
      })
    ).rejects.toMatchObject({ status: 400 });
    organizations.getOrgById.mockResolvedValue(null);
    await expect(
      controller.updateOrganization(token, 'missing', {
        channelLimits: { x: 1 },
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(organizations.setChannelLimits).not.toHaveBeenCalled();
  });

  it('POST provisioning sets limits when given and is unchanged otherwise', async () => {
    const withLimits = await controller.createOrganization(token, {
      name: 'Tenant',
      email: 'tenant@app-one.example.com',
      channelLimits: { youtube: 1 },
    });
    expect(withLimits).toMatchObject({
      organizationId: 'org-new',
      channelLimits: { youtube: 1 },
    });
    expect(organizations.setChannelLimits).toHaveBeenCalledWith('org-new', {
      youtube: 1,
    });

    jest.clearAllMocks();
    const plain = await controller.createOrganization(token, {
      name: 'Tenant',
      email: 'other@app-one.example.com',
    });
    expect(plain).not.toHaveProperty('channelLimits');
    expect(organizations.setChannelLimits).not.toHaveBeenCalled();
  });

  it('POST refuses bad limits before creating the org', async () => {
    await expect(
      controller.createOrganization(token, {
        name: 'Tenant',
        email: 'tenant@app-one.example.com',
        channelLimits: { youtube: -1 },
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(organizations.createOrgAndUser).not.toHaveBeenCalled();
  });
});
