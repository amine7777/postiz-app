import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateConnectLinkDto {
  @IsString()
  @IsOptional()
  provider?: string;

  @IsNumber()
  @IsOptional()
  expiresInHours?: number;
}
