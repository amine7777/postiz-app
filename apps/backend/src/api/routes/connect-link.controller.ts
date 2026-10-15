import { Controller, Get, HttpException, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ProviderCredentialService } from '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service';
import dayjs from 'dayjs';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { safeConnectReturn, returnCookieName, signReturnContext, RETURN_TTL, connectOrigin, readReturnContext } from '@gitroom/helpers/auth/connect-return';

@ApiTags('Connect Links')
@Controller('/connect')
export class ConnectLinkController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _organizationService: OrganizationService,
    private _providerCredentialService: ProviderCredentialService
  ) {}

  private validateToken(token: string): { orgId: string; linkId: string } {
    try {
      const payload = AuthService.verifyJWT(token) as {
        orgId: string;
        linkId: string;
        expiresAt: string;
      };

      if (!payload.orgId || !payload.linkId || !payload.expiresAt) {
        throw new HttpException({ msg: 'Invalid connect link' }, 400);
      }

      if (dayjs().isAfter(dayjs(payload.expiresAt))) {
        throw new HttpException({ msg: 'Connect link has expired' }, 410);
      }

      return payload;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new HttpException({ msg: 'Invalid connect link' }, 400);
    }
  }

  @Get('/:token/integrations')
  async getAvailableIntegrations(@Param('token') token: string) {
    const { orgId } = this.validateToken(token);

    const org = await this._organizationService.getOrgById(orgId);
    if (!org) {
      throw new HttpException({ msg: 'Organization not found' }, 404);
    }

    const integrations = await this._integrationManager.getAllIntegrations();

    return integrations.social
      .filter((i) => !i.isWeb3 && !i.isChromeExtension)
      .map((i) => ({
        name: i.name,
        identifier: i.identifier,
      }));
  }

  @Get('/:token/social/:integration')
  async getOAuthUrl(
    @Param('token') token: string,
    @Param('integration') integration: string,
    // Omission explicitly retains the native Postiz connect-link flow.
    @Query('redirectUrl') redirectUrl?: string
  ) {
    const { orgId, linkId } = this.validateToken(token);
    let returnURL: string | undefined;
    try { if (redirectUrl !== undefined) returnURL = safeConnectReturn(redirectUrl); } catch { throw new HttpException({ code: 'INVALID_RETURN_URL' }, 400); }

    const org = await this._organizationService.getOrgById(orgId);
    if (!org) {
      throw new HttpException({ msg: 'Organization not found' }, 404);
    }

    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new HttpException({ msg: 'Integration not allowed' }, 400);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    if (integrationProvider.externalUrl) {
      throw new HttpException(
        { msg: 'This integration requires external configuration and is not supported via connect links' },
        400
      );
    }

    const orgCreds = await this._providerCredentialService.getByOrgAndProvider(
      orgId,
      integration
    );
    const clientInfo = orgCreds
      ? { client_id: orgCreds.clientId, client_secret: orgCreds.clientSecret, instanceUrl: '' }
      : undefined;

    const generated = await integrationProvider.generateAuthUrl(clientInfo);
    const codeVerifier = generated.codeVerifier;
    let { state, url } = generated;
    const authorization = new URL(url);
    if (authorization.searchParams.get('state') === state) {
      state = randomUUID();
      authorization.searchParams.set('state', state);
      url = authorization.toString();
    }

    const context = { orgId, linkId, provider: integration, returnURL };
    await ioRedis.set(`organization:${state}`, orgId, 'EX', 3600);
    await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
    if (!returnURL) {
      await ioRedis.set(`redirect:${state}`, `${process.env.FRONTEND_URL}/connect/${token}?success=${integration}`, 'EX', 3600);
      return { url };
    }
    await ioRedis.set(`connect-context:${state}`, JSON.stringify(context), 'EX', RETURN_TTL);
    // Browser navigation through this one-use bootstrap is required: a cookie on
    // the server-to-server Plumeza request would never reach the browser.
    const bootstrap = randomUUID();
    await ioRedis.set(`connect-bootstrap:${bootstrap}`, JSON.stringify({ state, url, returnURL }), 'EX', 120);
    return { url: `${process.env.FRONTEND_URL}/api/connect/start/${bootstrap}` };
  }

  @Get('/start/:bootstrap')
  async start(@Param('bootstrap') bootstrap: string, @Res() response: Response, @Req() request?: Request) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const raw = await ioRedis.getdel(`connect-bootstrap:${bootstrap}`);
      if (!raw) throw new Error('Expired bootstrap');
      const { state, url, returnURL } = JSON.parse(raw);
      const target = new URL(url);
      if (target.protocol !== 'https:') throw new Error('Invalid provider URL');
      // Bound abandoned attempts without evicting another active browser tab.
      let active = 0;
      for (const [name, value] of Object.entries(request?.cookies || {})) {
        if (!name.startsWith('connect-return-')) continue;
        let valid = false;
        try {
          const payload = JSON.parse(Buffer.from(String(value).split('.')[0], 'base64url').toString());
          valid = name === returnCookieName(payload.state) && !!readReturnContext(payload.state, String(value));
        } catch { /* malformed or expired cookie */ }
        if (valid) active++; else response.clearCookie(name, { path: '/' });
      }
      if (active >= 4) return response.redirect(`${connectOrigin()}/connect/error?code=CONNECTION_FAILED`);
      response.cookie(returnCookieName(state), signReturnContext(state, returnURL), {
        httpOnly: true, secure: process.env.FRONTEND_URL?.startsWith('https://'),
        sameSite: 'lax', path: '/', maxAge: RETURN_TTL * 1000,
      });
      return response.redirect(target.toString());
    } catch {
      const origin = connectOrigin();
      if (origin) return response.redirect(`${origin}/connect/error?code=SESSION_EXPIRED`);
      throw new HttpException({ code: 'SESSION_EXPIRED' }, 410);
    }
  }

  @Get('/:token/result/:receipt')
  async result(@Param('token') token: string, @Param('receipt') receipt: string) {
    const { orgId, linkId } = this.validateToken(token);
    const raw = await ioRedis.get(`connect-result:${receipt}`);
    if (!raw) throw new HttpException({ code: 'RESULT_EXPIRED' }, 410);
    const result = JSON.parse(raw);
    if (result.orgId !== orgId || result.linkId !== linkId) throw new HttpException({ code: 'INVALID_RESULT' }, 404);
    return { integrationId: result.integrationId, provider: result.provider };
  }
}
