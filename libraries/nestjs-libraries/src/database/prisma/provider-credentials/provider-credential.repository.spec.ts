/** @jest-environment node */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: (v: string) => `enc(${v})`,
    fixedDecryption: (v: string) => v.replace(/^enc\((.*)\)$/, '$1'),
  },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({
  PrismaRepository: class {},
}));

import { ProviderCredentialRepository } from './provider-credential.repository';

describe('provider credential redirect URL', () => {
  const model = {
    upsert: jest.fn(async (args: any) => args),
    findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
  };
  const repository = new ProviderCredentialRepository({
    model: { providerCredential: model },
  } as any);

  it('stores it on create and update, and a missing one clears it', async () => {
    await repository.upsert('org', 'youtube', 'id', 'secret', 'https://app-one.example.com/r');
    expect((model.upsert.mock.calls[0][0] as any).create.redirectUrl).toBe('https://app-one.example.com/r');
    expect((model.upsert.mock.calls[0][0] as any).update.redirectUrl).toBe('https://app-one.example.com/r');
    await repository.upsert('org', 'youtube', 'id', 'secret');
    expect((model.upsert.mock.calls[1][0] as any).update.redirectUrl).toBeNull();
  });

  it('returns it with the decrypted app, or undefined when unset', async () => {
    model.findFirst.mockResolvedValueOnce({ clientId: 'enc(id)', clientSecret: 'enc(s)', redirectUrl: 'https://app-one.example.com/r' });
    expect(await repository.getByOrgAndProvider('org', 'youtube')).toEqual({
      clientId: 'id', clientSecret: 's', redirectUrl: 'https://app-one.example.com/r',
    });
    model.findFirst.mockResolvedValueOnce({ clientId: 'enc(id)', clientSecret: 'enc(s)', redirectUrl: null });
    expect((await repository.getByOrgAndProvider('org', 'youtube'))?.redirectUrl).toBeUndefined();
  });
});
