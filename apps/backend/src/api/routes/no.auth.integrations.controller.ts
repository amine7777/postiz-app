import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  UseFilters,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { safeConnectReturn, RETURN_TTL } from '@gitroom/helpers/auth/connect-return';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ConnectIntegrationDto } from '@gitroom/nestjs-libraries/dtos/integrations/connect.integration.dto';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { NotEnoughScopesFilter } from '@gitroom/nestjs-libraries/integrations/integration.missing.scopes';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ProviderCredentialService } from '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service';

@ApiTags('Integrations')
@Controller('/integrations')
export class NoAuthIntegrationsController {
  private readonly connectLogger = new Logger('ConnectOutcome');
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _organizationService: OrganizationService,
    private _providerCredentialService: ProviderCredentialService
  ) {}

  @Get('/')
  getIntegrations() {
    return this._integrationManager.getAllIntegrations();
  }

  @Post('/social-connect/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @UseFilters(new NotEnoughScopesFilter())
  async connectSocialMedia(
    @Param('integration') integration: string,
    @Body() body: ConnectIntegrationDto
  ) {
    return this.connectOutcome(body.state, integration, undefined, () => this.connectSocialMediaImpl(integration, body));
  }

  private async connectSocialMediaImpl(integration: string, body: ConnectIntegrationDto) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    const getCodeVerifier = integrationProvider.customFields
      ? 'none'
      : await ioRedis.get(`login:${body.state}`);
    if (!getCodeVerifier) {
      throw new Error('Invalid state');
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      throw new Error('Organization not found');
    }

    const org = await this._organizationService.getOrgById(organization);

    if (!integrationProvider.customFields) {
      await ioRedis.del(`login:${body.state}`);
    }

    const details = integrationProvider.externalUrl
      ? await ioRedis.get(`external:${body.state}`)
      : undefined;

    if (details) {
      await ioRedis.del(`external:${body.state}`);
    }

    const refresh = await ioRedis.get(`refresh:${body.state}`);
    if (refresh) {
      await ioRedis.del(`refresh:${body.state}`);
    }

    const onboarding = await ioRedis.get(`onboarding:${body.state}`);
    if (onboarding) {
      await ioRedis.del(`onboarding:${body.state}`);
    }

    const orgCreds = !details
      ? await this._providerCredentialService.getByOrgAndProvider(
          org!.id,
          integration
        )
      : null;

    const clientInfo = details
      ? JSON.parse(details)
      : orgCreds
        ? { client_id: orgCreds.clientId, client_secret: orgCreds.clientSecret, instanceUrl: '' }
        : undefined;

    const {
      error,
      accessToken,
      expiresIn,
      refreshToken,
      id,
      name,
      picture,
      username,
      additionalSettings,
      // eslint-disable-next-line no-async-promise-executor
    } = await new Promise<AuthTokenDetails>(async (res, reject) => {
      try {
        const auth = await integrationProvider.authenticate(
          {
            code: body.code,
            codeVerifier: getCodeVerifier,
            refresh: body.refresh,
          },
          clientInfo
        );

        if (typeof auth === 'string') {
          return res({
            error: auth,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        if (refresh && integrationProvider.reConnect) {
          console.log('reconnect');
          try {
            const newAuth = await integrationProvider.reConnect(
              auth.id,
              refresh,
              auth.accessToken
            );
            return res({ ...newAuth, refreshToken: body.refresh });
          } catch (err: any) {
            return reject(err);
          }
        }

        return res(auth);
      } catch (err) {
        if (err instanceof NotEnoughScopes) {
          return res({
            error: err.message,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        return reject(err);
      }
    });

    if (error) {
      throw new NotEnoughScopes(error);
    }

    if (!id) {
      throw new NotEnoughScopes('Invalid API key');
    }

    if (refresh && String(id) !== String(refresh)) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    let validName = name;
    if (!validName) {
      if (username) {
        validName = username.split('.')[0] ?? username;
      } else {
        validName = `Channel_${String(id).slice(0, 8)}`;
      }
    }

    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      org.isTrailing &&
      (await this._integrationService.checkPreviousConnections(
        org.id,
        String(id)
      ))
    ) {
      throw new HttpException('', 412);
    }

    const createUpdate =
      await this._integrationService.createOrUpdateIntegration(
        additionalSettings,
        !!integrationProvider.oneTimeToken,
        org.id,
        validName.trim(),
        picture,
        'social',
        String(id),
        integration,
        accessToken,
        refreshToken,
        expiresIn,
        username,
        refresh ? false : integrationProvider.isBetweenSteps,
        body.refresh,
        +body.timezone,
        details
          ? AuthService.fixedEncryption(details)
          : integrationProvider.customFields
          ? AuthService.fixedEncryption(
              Buffer.from(body.code, 'base64').toString()
            )
          : integrationProvider.isChromeExtension
          ? AuthService.signJWT(
              JSON.parse(Buffer.from(body.code, 'base64').toString())
            )
          : undefined
      );

    if (!createUpdate.inBetweenSteps) {
      this._refreshIntegrationService
        .startRefreshWorkflow(org.id, createUpdate.id, integrationProvider)
        .catch(() => console.warn('Could not start channel refresh workflow'));
    }

    // Fetch pages if this is a two-step provider and not a refresh
    let pages: any[] = [];
    if (integrationProvider.isBetweenSteps && !refresh) {
      try {
        // Check which method the provider uses (pages or companies)
        const fetchMethod =
          'pages' in integrationProvider
            ? 'pages'
            : 'companies' in integrationProvider
            ? 'companies'
            : null;

        if (fetchMethod) {
          // @ts-ignore - dynamic method call
          pages = await integrationProvider[fetchMethod](accessToken);
        }
      } catch (err) {
        console.log('Failed to fetch pages:', err);
      }
    }

    const webhookUrl = await ioRedis.get(`webhookUrl:${body.state}`);
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            params: AuthService.signJWT({
              apiKey: org.apiKey,
            }),
          }),
        });
      } catch (err) {}

      await ioRedis.del(`webhookUrl:${body.state}`);
    }

    const returnURL = await ioRedis.get(`redirect:${body.state}`);
    // For two-step providers (page/company selection) keep the redirect until
    // the final "save" step (saveProviderPage) so the client is still
    // redirected back after picking the page. Single-step providers consume it
    // now (the redirect happens immediately from this response).
    if (returnURL && !integrationProvider.isBetweenSteps) {
      await ioRedis.del(`redirect:${body.state}`);
    }

    const extensionToken = integrationProvider.isChromeExtension
      ? AuthService.signJWT({
          integrationId: createUpdate.id,
          organizationId: org.id,
          internalId: String(id),
          provider: integration,
        })
      : undefined;

    return {
      id: createUpdate.id,
      inBetweenSteps: createUpdate.inBetweenSteps,
      onboarding: onboarding === 'true',
      pages,
      ...(returnURL ? { returnURL } : {}),
      ...(extensionToken ? { extensionToken } : {}),
    };
  }

  @Post('/public/provider/:id/connect')
  async saveProviderPage(@Param('id') id: string, @Body() body: any) {
    return this.connectOutcome(body.state, undefined, id, () => this.saveProviderPageImpl(id, body));
  }

  private async saveProviderPageImpl(id: string, body: any) {
    if (!body.state) {
      throw new Error('Invalid state');
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      throw new Error('Organization not found');
    }

    const org = await this._organizationService.getOrgById(organization);

    const result = await this._integrationService.saveProviderPage(org.id, id, body);

    // Return the branded redirect URL (kept from the connect-link flow) so the
    // client is sent back to the connect page after saving the selected page.
    const returnURL = await ioRedis.get(`redirect:${body.state}`);
    if (returnURL) {
      await ioRedis.del(`redirect:${body.state}`);
    }

    return {
      ...(result && typeof result === 'object' ? result : { result }),
      ...(returnURL ? { returnURL } : {}),
    };
  }

  private async connectOutcome(state: string, provider: string | undefined, pendingId: string | undefined, work: () => Promise<any>) {
    const requestId = randomUUID();
    let context: any;
    try {
      const raw = await ioRedis.get(`connect-context:${state}`);
      context = raw ? JSON.parse(raw) : undefined;
      if (context) {
        safeConnectReturn(context.returnURL);
        const org = await ioRedis.get(`organization:${state}`);
        if (!org || org !== context.orgId) throw new HttpException({ code: 'SESSION_EXPIRED' }, 410);
        if ((provider && provider !== context.provider) || (pendingId && pendingId !== context.pendingIntegrationId)) {
          throw new HttpException({ code: 'INVALID_ATTEMPT' }, 400);
        }
      }
      const result = await work();
      if (!context) return { ...result, flow: 'native' };
      if (result.inBetweenSteps) {
        context.pendingIntegrationId = result.id;
        await ioRedis.set(`connect-context:${state}`, JSON.stringify(context), 'EX', RETURN_TTL);
        return { ...result, flow: 'external', returnURL: context.returnURL };
      }
      const saved = await this._integrationService.getIntegrationById(context.orgId, result.id);
      if (!saved || saved.deletedAt || saved.inBetweenSteps || saved.providerIdentifier !== context.provider) throw new Error('Unconfirmed integration');
      const receipt = randomUUID();
      await ioRedis.set(`connect-result:${receipt}`, JSON.stringify({
        orgId: context.orgId, linkId: context.linkId, state, provider: context.provider, integrationId: saved.id,
      }), 'EX', RETURN_TTL);
      return { ...result, flow: 'external', returnURL: context.returnURL, receipt };
    } catch (error: any) {
      const supplied = error instanceof HttpException ? error.getResponse() : undefined;
      const known = typeof supplied === 'object' ? (supplied as any)?.code : undefined;
      const expired = ['Invalid state', 'Organization not found'].includes(error?.message);
      const code = ['SESSION_EXPIRED', 'INVALID_ATTEMPT'].includes(known) ? known
        : expired ? 'SESSION_EXPIRED' : error instanceof NotEnoughScopes ? 'PROVIDER_REJECTED'
        : pendingId ? 'SAVE_FAILED' : 'CONNECTION_FAILED';
      this.connectLogger.warn(JSON.stringify({ event: 'connect_failed', requestId, provider: provider || context?.provider, code }));
      throw new HttpException({ code, requestId, ...(context ? { returnURL: context.returnURL, flow: 'external' } : {}) }, code === 'SESSION_EXPIRED' ? 410 : error instanceof HttpException ? error.getStatus() : 400);
    }
  }

  @Post('/extension-refresh')
  async extensionRefreshCookies(
    @Body() body: { jwt: string; cookies: string }
  ) {
    let payload: any;
    try {
      payload = AuthService.verifyJWT(body.jwt);
    } catch {
      throw new HttpException('Invalid token', 401);
    }

    const { integrationId, organizationId, internalId, provider } = payload;
    if (!integrationId || !organizationId || !internalId || !provider) {
      throw new HttpException('Invalid token payload', 400);
    }

    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration || integration.internalId !== internalId) {
      throw new HttpException('Integration not found', 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(provider);
    if (!integrationProvider?.isChromeExtension) {
      throw new HttpException('Not a Chrome extension integration', 400);
    }

    const authResult = await integrationProvider.authenticate({
      code: body.cookies,
      codeVerifier: '',
    });

    if (typeof authResult === 'string') {
      throw new HttpException(authResult, 400);
    }

    if (String(authResult.id) !== String(integration.internalId)) {
      await this._integrationService.refreshNeeded(
        organizationId,
        integrationId
      );
      return { success: false, reason: 'account_mismatch' };
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      organizationId,
      integration.name,
      undefined,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      authResult.accessToken,
      '',
      authResult.expiresIn,
      undefined,
      false,
      undefined,
      undefined,
      AuthService.signJWT(
        JSON.parse(Buffer.from(body.cookies, 'base64').toString())
      )
    );

    return { success: true };
  }
}
