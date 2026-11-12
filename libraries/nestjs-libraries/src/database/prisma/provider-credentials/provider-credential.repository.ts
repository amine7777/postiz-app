import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

@Injectable()
export class ProviderCredentialRepository {
  constructor(
    private _providerCredential: PrismaRepository<'providerCredential'>
  ) {}

  async getByOrgAndProvider(orgId: string, provider: string) {
    const record =
      await this._providerCredential.model.providerCredential.findFirst({
        where: { organizationId: orgId, provider, deletedAt: null },
      });

    if (!record) {
      return null;
    }

    return {
      clientId: AuthService.fixedDecryption(record.clientId),
      clientSecret: AuthService.fixedDecryption(record.clientSecret),
      redirectUrl: record.redirectUrl ?? undefined,
    };
  }

  upsert(
    orgId: string,
    provider: string,
    clientId: string,
    clientSecret: string,
    redirectUrl?: string | null
  ) {
    const encryptedClientId = AuthService.fixedEncryption(clientId);
    const encryptedClientSecret = AuthService.fixedEncryption(clientSecret);

    return this._providerCredential.model.providerCredential.upsert({
      where: {
        organizationId_provider: {
          organizationId: orgId,
          provider,
        },
      },
      create: {
        organizationId: orgId,
        provider,
        clientId: encryptedClientId,
        clientSecret: encryptedClientSecret,
        redirectUrl: redirectUrl || null,
      },
      // PUT replaces the app: a missing redirectUrl clears it.
      update: {
        clientId: encryptedClientId,
        clientSecret: encryptedClientSecret,
        redirectUrl: redirectUrl || null,
        deletedAt: null,
      },
    });
  }

  delete(orgId: string, provider: string) {
    return this._providerCredential.model.providerCredential.updateMany({
      where: { organizationId: orgId, provider, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  listByOrg(orgId: string) {
    return this._providerCredential.model.providerCredential.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        provider: true,
        redirectUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
