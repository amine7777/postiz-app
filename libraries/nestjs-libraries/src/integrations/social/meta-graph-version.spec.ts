import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

describe('Meta Graph API version', () => {
  const originalAppId = process.env.FACEBOOK_APP_ID;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = 'test-app-id';
    process.env.FRONTEND_URL = 'https://app.example.test';
  });

  afterAll(() => {
    if (originalAppId === undefined) delete process.env.FACEBOOK_APP_ID;
    else process.env.FACEBOOK_APP_ID = originalAppId;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('uses the shared current version and excludes the retired read_insights scope for Facebook', async () => {
    const { url } = await new FacebookProvider().generateAuthUrl();
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/v25.0/dialog/oauth');
    expect(parsed.searchParams.get('scope')).not.toContain('read_insights');
  });

  it('uses the shared current version for Instagram business authorization', async () => {
    const { url } = await new InstagramProvider().generateAuthUrl();
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/v25.0/dialog/oauth');
  });
});
