import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsDefined,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Provider } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

class ProvisionOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @IsDefined()
  name: string;

  @IsEmail()
  @IsDefined()
  email: string;
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
 *   body:   { name, email }
 *   -> { organizationId, userId, email, password, apiKey }
 */
@Controller('/provisioning')
export class AdminProvisionController {
  constructor(
    private _organizationService: OrganizationService,
    private _usersService: UsersService
  ) {}

  private assertAdmin(adminToken: string) {
    const expected = process.env.POSTIZ_ADMIN_TOKEN;
    if (!expected || !adminToken || adminToken !== expected) {
      throw new UnauthorizedException('Invalid admin token');
    }
  }

  /** The org, or 404; 409 once it was deleted. */
  private async liveOrg(adminToken: string, id: string) {
    this.assertAdmin(adminToken);
    const org = await this._organizationService.getOrgById(id);
    if (!org) throw new NotFoundException('Organization not found');
    if (org.deletedAt) throw new ConflictException('Organization was deleted');
    return org;
  }

  /**
   * Admin lifecycle, all gated by x-admin-token:
   *
   *   POST   /provisioning/organizations/:id/disable         -> { organizationId, disabled: true }
   *   POST   /provisioning/organizations/:id/enable          -> { organizationId, disabled: false }
   *   POST   /provisioning/organizations/:id/rotate-api-key  -> { organizationId, apiKey }
   *   DELETE /provisioning/organizations/:id                 -> { organizationId, deleted: true, channels, posts }
   *
   * Disabled: the API key and OAuth tokens get 403, connect links get 403,
   * scheduled posts are not published. Channels and posts are kept, so enable
   * restores everything. Delete is irreversible (see deleteOrganization).
   */
  @Post('/organizations/:id/disable')
  @HttpCode(200)
  async disableOrganization(
    @Headers('x-admin-token') adminToken: string,
    @Param('id') id: string
  ) {
    await this.liveOrg(adminToken, id);
    await this._organizationService.setDisabled(id, true);
    return { organizationId: id, disabled: true };
  }

  @Post('/organizations/:id/enable')
  @HttpCode(200)
  async enableOrganization(
    @Headers('x-admin-token') adminToken: string,
    @Param('id') id: string
  ) {
    await this.liveOrg(adminToken, id);
    await this._organizationService.setDisabled(id, false);
    return { organizationId: id, disabled: false };
  }

  @Post('/organizations/:id/rotate-api-key')
  @HttpCode(200)
  async rotateApiKey(
    @Headers('x-admin-token') adminToken: string,
    @Param('id') id: string
  ) {
    await this.liveOrg(adminToken, id);
    const updated = await this._organizationService.updateApiKey(id);
    return { organizationId: id, apiKey: updated.apiKey };
  }

  @Delete('/organizations/:id')
  async deleteOrganization(
    @Headers('x-admin-token') adminToken: string,
    @Param('id') id: string
  ) {
    await this.liveOrg(adminToken, id);
    const removed = await this._organizationService.deleteOrganization(id);
    return { organizationId: id, deleted: true, ...removed };
  }

  @Post('/organizations')
  async createOrganization(
    @Headers('x-admin-token') adminToken: string,
    @Body() body: ProvisionOrgDto
  ) {
    this.assertAdmin(adminToken);

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
        if (fullExisting?.deletedAt) {
          // Its key is revoked; returning it would hand back a dead org.
          throw new ConflictException('Organization was deleted');
        }
        return {
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

    // L'apiKey stockée est la clé utilisable telle quelle par l'API publique.
    const full = await this._organizationService.getOrgById(org.id);

    return {
      organizationId: org.id,
      userId,
      email: body.email,
      password, // mot de passe temporaire — renvoyé une seule fois
      apiKey: full?.apiKey,
    };
  }
}
