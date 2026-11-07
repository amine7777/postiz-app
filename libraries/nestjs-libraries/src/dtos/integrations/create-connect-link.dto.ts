import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateConnectLinkDto {
  @IsString()
  @IsOptional()
  provider?: string;

  @IsNumber()
  @IsOptional()
  expiresInHours?: number;

  /** Id of one of the org's channels: the link reconnects that channel. */
  @IsString()
  @IsOptional()
  refresh?: string;

  /** Return the pending page-selection step to the calling application. */
  @IsBoolean()
  @IsOptional()
  pickInApp?: boolean;
}
