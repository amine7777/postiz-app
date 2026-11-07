import { IsNumber, IsOptional, IsString } from 'class-validator';

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
}
