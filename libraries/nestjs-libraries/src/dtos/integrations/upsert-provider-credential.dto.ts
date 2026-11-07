import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertProviderCredentialDto {
  @IsString()
  @IsDefined()
  clientId: string;

  @IsString()
  @IsDefined()
  clientSecret: string;

  /**
   * OAuth redirect URI registered on this app, when it is not the host's own
   * `${FRONTEND_URL}/integrations/social/<provider>`: a page on the app
   * owner's domain that forwards the browser, query unchanged, to the host's.
   * https only, no query or hash. Used by YouTube.
   */
  @IsString()
  @IsOptional()
  @MaxLength(300)
  redirectUrl?: string;
}
