/** @jest-environment node */
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';
import { ConnectLinkController } from './connect-link.controller';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { Logger } from '@nestjs/common';
import { ProviderConnectionError } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { readReturnContext } from '@gitroom/helpers/auth/connect-return';
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({ uploadSimple: async (url: string) => url }),
  },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository',
  () => ({ AutopostRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), del: jest.fn(), set: jest.fn(), getdel: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class {},
  NotEnoughScopes: class {},
  ProviderConnectionError: class ProviderConnectionError extends Error {
    constructor(public stage: string, public status?: number) { super('Social provider connection failed'); }
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/provider-credentials/provider-credential.service',
  () => ({ ProviderCredentialService: class {} })
);
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/integration.missing.scopes',
  () => ({
    NotEnoughScopesFilter: class {
      catch() {}
    },
  })
);
jest.mock(
  '@gitroom/backend/services/auth/permissions/permissions.ability',
  () => ({ CheckPolicies: () => () => undefined })
);


function fixture() {
 const store = new Map<string,string>();
 (ioRedis.get as jest.Mock).mockImplementation(async(key:string)=>store.get(key)||null);
 (ioRedis.set as jest.Mock).mockImplementation(async(key:string,value:string)=>{store.set(key,value);return 'OK';});
 (ioRedis.getdel as jest.Mock).mockImplementation(async(key:string)=>{const value=store.get(key);store.delete(key);return value;});
 (ioRedis.del as jest.Mock).mockImplementation(async(key:string)=>{store.delete(key);return 1;});
 const manager={getAllowedSocialsIntegrations:()=>['linkedin-page','x'],getSocialIntegration:()=>({generateAuthUrl:async()=>({state:'original-state',codeVerifier:'verifier',url:'https://linkedin.com/oauth?state=original-state'})})};
 const integrations={getIntegrationById:jest.fn().mockResolvedValue({id:'saved-id',providerIdentifier:'linkedin-page',inBetweenSteps:false})};
 const orgs={getOrgById:async()=>({id:'org-a'})};
 const creds={getByOrgAndProvider:async()=>null};
 (AuthService as any).verifyJWT=jest.fn().mockReturnValue({orgId:'org-a',linkId:'link-a',expiresAt:'2099-01-01'});
 const links=new ConnectLinkController(manager as any,orgs as any,creds as any);
 const controller=new NoAuthIntegrationsController(manager as any,integrations as any,{} as any,orgs as any,creds as any);
 const response={setHeader:jest.fn(),cookie:jest.fn(),clearCookie:jest.fn(),redirect:jest.fn()};
 return {store,manager,integrations,links,controller,response};
}
beforeEach(()=>{jest.clearAllMocks();process.env.JWT_SECRET='test-only';process.env.CONNECT_RETURN_ORIGIN='https://app.plumeza.io';process.env.FRONTEND_URL='https://postiz.cloudeefy.io';});

describe('external OAuth contract',()=>{
 it('uses a first-party browser bootstrap and a state-scoped signed cookie',async()=>{
  const {links,store,response}=fixture();
  const result=await links.getOAuthUrl('token','linkedin-page','https://app.plumeza.io/connect/token');
  expect(result.url).toMatch(/^https:\/\/postiz.cloudeefy.io\/api\/connect\/start\//);
  const bootstrap=result.url.split('/').pop()!;
  const raw=JSON.parse(store.get('connect-bootstrap:'+bootstrap)!);
  expect(raw.state).not.toBe('original-state');
  await links.start(bootstrap,response as any);
  expect(response.redirect).toHaveBeenCalledWith(expect.stringContaining('https://linkedin.com/oauth?state='));
  const [,cookie,options]=response.cookie.mock.calls[0];
  expect(readReturnContext(raw.state,cookie)).toBe('https://app.plumeza.io/connect/token');
  expect(options).toMatchObject({httpOnly:true,sameSite:'lax',secure:true});
  await links.start(bootstrap,response as any);
  expect(response.redirect).toHaveBeenLastCalledWith('https://app.plumeza.io/connect/error?code=SESSION_EXPIRED');
 });
 it('preserves OAuth1 tokens while still providing a bootstrap return cookie',async()=>{
  const f=fixture();f.manager.getSocialIntegration=()=>({generateAuthUrl:async()=>({state:'twitter-token',codeVerifier:'secret',url:'https://api.x.com/oauth/authenticate?oauth_token=twitter-token'})});
  const result=await f.links.getOAuthUrl('token','x','https://app.plumeza.io/connect/token');
  const raw=JSON.parse(f.store.get('connect-bootstrap:'+result.url.split('/').pop())!);expect(raw.state).toBe('twitter-token');
 });
 it('preserves native links without requiring an external return URL',async()=>{
  const f=fixture();const result=await f.links.getOAuthUrl('token','linkedin-page');
  const state=new URL(result.url).searchParams.get('state');
  expect(f.store.get(`organization:${state}`)).toBe('org-a');
  expect(f.store.get(`redirect:${state}`)).toBe('https://postiz.cloudeefy.io/connect/token?success=linkedin-page');
  expect(f.store.has(`connect-context:${state}`)).toBe(false);
 });
 it('bounds abandoned attempts without evicting active tabs',async()=>{
  const f=fixture();const cookies:Record<string,string>={};
  for(let i=0;i<4;i++){
    const result=await f.links.getOAuthUrl('token','linkedin-page','https://app.plumeza.io/connect/token');
    await f.links.start(result.url.split('/').pop()!,f.response as any,{cookies} as any);
    const [name,value]=f.response.cookie.mock.calls[i];cookies[name]=value;
  }
  const result=await f.links.getOAuthUrl('token','linkedin-page','https://app.plumeza.io/connect/token');
  await f.links.start(result.url.split('/').pop()!,f.response as any,{cookies} as any);
  expect(f.response.cookie).toHaveBeenCalledTimes(4);
  expect(f.response.clearCookie).not.toHaveBeenCalled();
  expect(f.response.redirect).toHaveBeenLastCalledWith('https://app.plumeza.io/connect/error?code=CONNECTION_FAILED');
 });
 it('refuses an arbitrary browser return origin' ,async()=>{
  const {links}=fixture();await expect(links.getOAuthUrl('token','linkedin-page','https://evil.example/connect/token')).rejects.toMatchObject({status:400});
 });
 it('retains context through page selection and creates a scoped receipt only after final save',async()=>{
  const f=fixture(); const context={orgId:'org-a',linkId:'link-a',provider:'linkedin-page',returnURL:'https://app.plumeza.io/connect/token'};
  f.store.set('connect-context:state',JSON.stringify(context));f.store.set('organization:state','org-a');
  const selection=await (f.controller as any).connectOutcome('state','linkedin-page',undefined,async()=>({id:'pending-a',inBetweenSteps:true}));
  expect(selection.receipt).toBeUndefined();
  const saved=await (f.controller as any).connectOutcome('state',undefined,'pending-a',async()=>({id:'saved-id'}));
  expect(saved.receipt).toMatch(/^[0-9a-f-]{36}$/);
  expect(await f.links.result('token',saved.receipt)).toEqual({integrationId:'saved-id',provider:'linkedin-page'});
  (AuthService as any).verifyJWT.mockReturnValueOnce({orgId:'org-a',linkId:'other-link',expiresAt:'2099-01-01'});
  await expect(f.links.result('other-token',saved.receipt)).rejects.toMatchObject({status:404});
 });
 it('does not finalize a different attempt or issue a receipt for an unconfirmed page',async()=>{
  const f=fixture();f.store.set('connect-context:state',JSON.stringify({orgId:'org-a',linkId:'link-a',provider:'linkedin-page',pendingIntegrationId:'pending-a',returnURL:'https://app.plumeza.io/connect/token'}));f.store.set('organization:state','org-a');
  const work=jest.fn();await expect((f.controller as any).connectOutcome('state',undefined,'foreign-pending',work)).rejects.toMatchObject({status:400});expect(work).not.toHaveBeenCalled();
  f.integrations.getIntegrationById.mockResolvedValueOnce(null);
  await expect((f.controller as any).connectOutcome('state',undefined,'pending-a',async()=>({id:'saved-id'}))).rejects.toMatchObject({status:400});
  expect([...f.store.keys()].some(k=>k.startsWith('connect-result:'))).toBe(false);
 });
 it('returns safe codes and request IDs without exposing raw provider errors',async()=>{
  const f=fixture();f.store.set('connect-context:state',JSON.stringify({orgId:'org-a',linkId:'link-a',provider:'linkedin-page',returnURL:'https://app.plumeza.io/connect/token'}));
  try{await (f.controller as any).connectOutcome('state','linkedin-page',undefined,async()=>{throw new Error('access_token=secret');});throw Error('expected rejection');}
  catch(error:any){expect(error.getResponse()).toMatchObject({code:'SESSION_EXPIRED',requestId:expect.any(String)});expect(JSON.stringify(error.getResponse())).not.toContain('secret');}
 });
 it('does not report a provider transport failure as a permission rejection',async()=>{
  const f=fixture();f.store.set('connect-context:state',JSON.stringify({orgId:'org-a',linkId:'link-a',provider:'linkedin-page',returnURL:'https://app.plumeza.io/connect/token'}));f.store.set('organization:state','org-a');
  const warning=jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>undefined as any);
  await expect((f.controller as any).connectOutcome('state','linkedin-page',undefined,async()=>{throw new ProviderConnectionError('token_exchange',400);})).rejects.toMatchObject({response:{code:'CONNECTION_FAILED'}});
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('"stage":"token_exchange"'));
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('"status":400'));
 });
 it('preserves explicit native success and never creates a branded receipt for it',async()=>{
  const f=fixture();expect(await (f.controller as any).connectOutcome('native-state','linkedin-page',undefined,async()=>({id:'native-id'}))).toEqual({id:'native-id',flow:'native'});
 });
});
