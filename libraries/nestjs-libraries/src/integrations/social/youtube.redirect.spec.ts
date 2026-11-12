/** @jest-environment node */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// Records how the OAuth client is built and used; no network.
const built: any[] = [];
const authUrlCalls: any[] = [];
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        constructor(public opts: any) {
          built.push(opts);
        }
        generateAuthUrl(args: any) {
          authUrlCalls.push(args);
          return `https://accounts.google.com/o?redirect_uri=${encodeURIComponent(args.redirect_uri)}`;
        }
        async getToken() {
          return { tokens: { access_token: 'a', refresh_token: 'r', expiry_date: Date.now() + 3600e3 } };
        }
        setCredentials() {}
        async getTokenInfo() {
          return { scopes: [] as string[] };
        }
      },
    },
    youtube: () => ({}),
    youtubeAnalytics: () => ({}),
    oauth2: () => ({ userinfo: { get: async () => ({ data: { id: 'g-1', name: 'Me' } }) } }),
  },
}));

import { YoutubeProvider } from './youtube.provider';
import { assertRedirectUrl } from './social.integrations.interface';

describe('YouTube with an org app redirect URI', () => {
  const provider = new YoutubeProvider();
  (provider as any).checkScopes = () => true;
  const app = { client_id: 'id', client_secret: 'secret', instanceUrl: '' };
  const own = 'https://app-one.example.com/oauth/return/youtube';

  beforeEach(() => {
    built.length = 0;
    authUrlCalls.length = 0;
    process.env.FRONTEND_URL = 'https://host.example.com';
  });

  it('uses the org redirect URI for the consent URL and the code exchange', async () => {
    const { url } = await provider.generateAuthUrl({ ...app, redirect_uri: own });
    expect(authUrlCalls[0].redirect_uri).toBe(own);
    expect(built[0].redirectUri).toBe(own);
    expect(url).toContain(encodeURIComponent(own));

    await provider.authenticate({ code: 'c', codeVerifier: 'v' }, { ...app, redirect_uri: own });
    expect(built[1]).toMatchObject({ clientId: 'id', clientSecret: 'secret', redirectUri: own });
  });

  it('without one, keeps the host callback exactly as before', async () => {
    await provider.generateAuthUrl(app);
    await provider.authenticate({ code: 'c', codeVerifier: 'v' }, app);
    const host = 'https://host.example.com/integrations/social/youtube';
    expect(authUrlCalls[0].redirect_uri).toBe(host);
    expect(built.map((b) => b.redirectUri)).toEqual([host, host]);
  });
});

describe('assertRedirectUrl', () => {
  it('accepts a plain https URL', () => {
    expect(assertRedirectUrl('https://app-one.example.com/oauth/return/youtube')).toBe(
      'https://app-one.example.com/oauth/return/youtube'
    );
  });
  it.each([
    'http://app-one.example.com/r',
    'https://user:pw@app-one.example.com/r',
    'https://app-one.example.com/r?next=x',
    'https://app-one.example.com/r#x',
    'not a url',
  ])('refuses %s', (value) => {
    expect(() => assertRedirectUrl(value)).toThrow();
  });
});
