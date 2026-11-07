import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Provider } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { parseChannelLimits } from '@gitroom/nestjs-libraries/database/prisma/integrations/channel-limits';

class ProvisionOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsDefined()
  name: string;

  @IsEmail()
  @IsDefined()
  email: string;

  /** Optional { [provider]: maxActiveChannels }; null clears. See PATCH below. */
  @IsOptional()
  channelLimits?: unknown;
}

class UpdateOrgDto {
  @IsDefined()
  channelLimits: unknown;
}

/**
 * Admin provisioning endpoint (no org-API-key auth — gated by POSTIZ_ADMIN_TOKEN).
 *
 * Used by the Cloudeefly "Social Media (agences)" service to create one Postiz
 * Organization per client on the shared instance, over HTTPS (the Postiz DB is
 * not reachable from the K8s-deployed Cloudeefly). Public registration is
 * disabled, so this is the supported way to create orgs programmatically.
 *
 *   POST /provisioning/organizations
 *   header: x-admin-token: <POSTIZ_ADMIN_TOKEN>
 *   body:   { name, email, channelLimits? }
 *   -> { organizationId, userId, email, password, apiKey }
 *      (+ channelLimits, disabledChannels when channelLimits is sent)
 */
@Controller('/provisioning')
export class AdminProvisionController {
  constructor(
    private _organizationService: OrganizationService,
    private _usersService: UsersService,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}

  private assertAdmin(adminToken: string) {
    const expected = process.env.POSTIZ_ADMIN_TOKEN;
    if (!expected || !adminToken || adminToken !== expected) {
      throw new UnauthorizedException('Invalid admin token');
    }
  }

  private parseLimits(value: unknown) {
    try {
      return parseChannelLimits(
        value,
        this._integrationManager.getAllowedSocialsIntegrations()
      );
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  /**
   * Saves the limits, then disables the newest active channels over them and
   * enables channels they had disabled once there is room again.
   */
  private async applyLimits(orgId: string, value: unknown) {
    const limits = this.parseLimits(value);
    const saved = await this._organizationService.setChannelLimits(
      orgId,
      limits
    );
    const { disabled, enabled } =
      await this._integrationService.applyChannelLimits(orgId, limits);
    return {
      channelLimits: saved.channelLimits ?? null,
      disabledChannels: disabled,
      enabledChannels: enabled,
    };
  }

  /**
   *   PATCH /provisioning/organizations/:id
   *   header: x-admin-token: <POSTIZ_ADMIN_TOKEN>
   *   body:   { channelLimits: { youtube: 2, x: 1 } | null }
   *   -> { organizationId, channelLimits, disabledChannels, enabledChannels }
   *
   * Limits count active channels (not disabled, not deleted) per provider and
   * are enforced when a channel is connected, a page is selected or a channel
   * is enabled. Lowering a limit keeps the oldest channels and disables the
   * rest (disabledByLimit); raising or removing it enables those again, oldest
   * first. Channels the user disabled stay disabled. Providers without a
   * limit, and orgs with null, are unlimited.
   */
  @Patch('/organizations/:id')
  async updateOrganization(
    @Headers('x-admin-token') adminToken: string,
    @Param('id') id: string,
    @Body() body: UpdateOrgDto
  ) {
    this.assertAdmin(adminToken);
    if (!(await this._organizationService.getOrgById(id))) {
      throw new NotFoundException('Organization not found');
    }
    return {
      organizationId: id,
      ...(await this.applyLimits(id, body.channelLimits)),
    };
  }

  @Post('/organizations')
  async createOrganization(
    @Headers('x-admin-token') adminToken: string,
    @Body() body: ProvisionOrgDto
  ) {
    this.assertAdmin(adminToken);
    if (body.channelLimits !== undefined) {
      this.parseLimits(body.channelLimits);
    }

    // Idempotent: a LOCAL user with this email may already exist (client
    // provisioned before, or a Cloudeefly account deleted & re-created). Return
    // the existing org + apiKey instead of failing on the unique
    // (email, providerName) constraint with a 500.
    const existingUser = await this._usersService.getUserByEmail(body.email);
    if (existingUser) {
      const orgs = await this._organizationService.getOrgsByUserId(
        existingUser.id
      );
      const existingOrg = orgs?.[0];
      if (existingOrg) {
        const fullExisting = await this._organizationService.getOrgById(
          existingOrg.id
        );
        const limits =
          body.channelLimits !== undefined
            ? await this.applyLimits(existingOrg.id, body.channelLimits)
            : {};
        return {
          ...limits,
          organizationId: existingOrg.id,
          userId: existingUser.id,
          email: body.email,
          password: '', // existing user — password is not reissued
          apiKey: fullExisting?.apiKey,
          existing: true,
        };
      }
    }

    const password = makeId(14);
    const org = await this._organizationService.createOrgAndUser(
      {
        company: body.name,
        email: body.email,
        password,
        provider: Provider.LOCAL,
        datafast_visitor_id: '',
      },
      '',
      'cloudeefly-provisioning'
    );

    // createOrgAndUser laisse le user non activé (LOCAL + SMTP) → activation
    // immédiate pour permettre le login sans email de confirmation.
    const userId = org?.users?.[0]?.user?.id;
    if (userId) {
      await this._usersService.activateUser(userId);
    }

    const limits =
      body.channelLimits !== undefined
        ? await this.applyLimits(org.id, body.channelLimits)
        : {};

    // L'apiKey stockée est la clé utilisable telle quelle par l'API publique.
    const full = await this._organizationService.getOrgById(org.id);

    return {
      ...limits,
      organizationId: org.id,
      userId,
      email: body.email,
      password, // mot de passe temporaire — renvoyé une seule fois
      apiKey: full?.apiKey,
    };
  }
}
