import { Injectable } from '@nestjs/common';
import { ProviderCredentialRepository } from '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.repository';

@Injectable()
export class ProviderCredentialService {
  constructor(
    private _providerCredentialRepository: ProviderCredentialRepository
  ) {}

  getByOrgAndProvider(orgId: string, provider: string) {
    return this._providerCredentialRepository.getByOrgAndProvider(
      orgId,
      provider
    );
  }

  upsert(
    orgId: string,
    provider: string,
    clientId: string,
    clientSecret: string,
    redirectUrl?: string | null
  ) {
    return this._providerCredentialRepository.upsert(
      orgId,
      provider,
      clientId,
      clientSecret,
      redirectUrl
    );
  }

  delete(orgId: string, provider: string) {
    return this._providerCredentialRepository.delete(orgId, provider);
  }

  listByOrg(orgId: string) {
    return this._providerCredentialRepository.listByOrg(orgId);
  }
}
