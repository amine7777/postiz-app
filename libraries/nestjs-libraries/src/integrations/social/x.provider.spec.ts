jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({
  readOrFetch: jest.fn(),
}));

jest.mock('sharp', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    v2: { me: jest.fn().mockResolvedValue({ data: { username: 'poster' } }) },
  })),
}));

import { createHmac } from 'crypto';
import { TwitterApi } from 'twitter-api-v2';
import { XProvider } from './x.provider';
import { readOrFetch } from '@gitroom/helpers/utils/read.or.fetch';
import sharp from 'sharp';

const mockedReadOrFetch = readOrFetch as jest.MockedFunction<typeof readOrFetch>;
const mockedSharp = sharp as unknown as jest.Mock;

describe('XProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadOrFetch.mockResolvedValue(Buffer.from('media'));
  });

  describe('uploadMediaFile', () => {
    it('uses the V1 upload path for video media', async () => {
      const provider = new XProvider();
      const client = {
        v1: { uploadMedia: jest.fn().mockResolvedValue('video-id') },
        v2: { uploadMedia: jest.fn() },
      } as any;

      await expect(
        (provider as any).uploadMediaFile(client, 'https://example.com/video.mp4')
      ).resolves.toBe('video-id');

      expect(client.v1.uploadMedia).toHaveBeenCalledWith(
        expect.any(Buffer),
        { mimeType: 'video/mp4' }
      );
      expect(client.v2.uploadMedia).not.toHaveBeenCalled();
    });

    it('keeps image media on the V2 path', async () => {
      const provider = new XProvider();
      const toBuffer = jest.fn().mockResolvedValue(Buffer.from('gif'));
      mockedSharp.mockReturnValue({
        resize: () => ({
          gif: () => ({ toBuffer }),
        }),
      });
      const client = {
        v1: { uploadMedia: jest.fn() },
        v2: { uploadMedia: jest.fn().mockResolvedValue('image-id') },
      } as any;

      await expect(
        (provider as any).uploadMediaFile(client, 'https://example.com/image.png')
      ).resolves.toBe('image-id');

      expect(client.v1.uploadMedia).not.toHaveBeenCalled();
      expect(client.v2.uploadMedia).toHaveBeenCalledWith(
        expect.any(Buffer),
        { media_type: 'image/png' }
      );
    });
  });

  describe('handleErrors', () => {
    it('preserves the provider status and message for upload failures', () => {
      const provider = new XProvider();

      expect(
        provider.handleErrors(
          JSON.stringify({
            code: 400,
            detail: 'The media type is not supported',
          })
        )
      ).toEqual({
        type: 'bad-body',
        value: 'X rejected the request (HTTP 400): The media type is not supported',
      });
    });

    it('does not expose an opaque provider error as a successful result', () => {
      const provider = new XProvider();

      expect(provider.handleErrors(JSON.stringify({ code: 400 }))).toEqual({
        type: 'bad-body',
        value: 'X rejected the request (HTTP 400)',
      });
    });
  });

  describe('org X app credentials', () => {
    const integration = {
      organizationId: 'org-1',
      token: 'user-token:user-secret',
    } as any;
    const tweetUrl = 'https://api.x.com/2/tweets';

    beforeEach(() => {
      process.env.X_API_KEY = 'env-key';
      process.env.X_API_SECRET = 'env-secret';
    });

    async function postWith(appCredentials?: jest.Mock) {
      const provider = new XProvider();
      provider.appCredentials = appCredentials;
      const fetch = jest.spyOn(provider, 'fetch').mockResolvedValue({
        json: async () => ({ data: { id: 'tweet-1' } }),
      } as any);
      await provider.post(
        'internal-id',
        integration.token,
        [{ id: 'p1', message: 'hi', settings: {}, media: [] } as any],
        integration
      );
      return (fetch.mock.calls[0][1] as any).headers.Authorization as string;
    }

    // Recomputes the HMAC-SHA1 signature of an OAuth 1.0a header.
    function signedWith(header: string, consumerSecret: string) {
      const params = Object.fromEntries(
        [...header.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [
          k,
          decodeURIComponent(v),
        ])
      );
      const { oauth_signature, ...rest } = params;
      const base = [
        'POST',
        encodeURIComponent(tweetUrl),
        encodeURIComponent(
          Object.keys(rest)
            .sort()
            .map((k) => `${k}=${encodeURIComponent(rest[k])}`)
            .join('&')
        ),
      ].join('&');
      return (
        createHmac('sha1', `${consumerSecret}&user-secret`)
          .update(base)
          .digest('base64') === oauth_signature
      );
    }

    it('posts through the org app when the org has X credentials', async () => {
      const creds = jest
        .fn()
        .mockResolvedValue({ clientId: 'org-key', clientSecret: 'org-secret' });

      const header = await postWith(creds);

      expect(creds).toHaveBeenCalledWith('org-1');
      expect(TwitterApi).toHaveBeenCalledWith({
        appKey: 'org-key',
        appSecret: 'org-secret',
        accessToken: 'user-token',
        accessSecret: 'user-secret',
      });
      expect(header).toContain('oauth_consumer_key="org-key"');
      expect(signedWith(header, 'org-secret')).toBe(true);
    });

    it('keeps the env app when the org has no X credentials', async () => {
      const header = await postWith(jest.fn().mockResolvedValue(null));

      expect(TwitterApi).toHaveBeenCalledWith(
        expect.objectContaining({ appKey: 'env-key', appSecret: 'env-secret' })
      );
      expect(header).toContain('oauth_consumer_key="env-key"');
      expect(signedWith(header, 'env-secret')).toBe(true);
    });

    it('keeps the env app when no credential lookup is wired', async () => {
      const header = await postWith();

      expect(header).toContain('oauth_consumer_key="env-key"');
    });
  });
});
