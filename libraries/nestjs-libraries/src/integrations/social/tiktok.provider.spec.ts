import 'reflect-metadata';
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));
import { TiktokProvider } from './tiktok.provider';

describe('TiktokProvider creatorInfo', () => {
  const provider = new TiktokProvider();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes the creator-info method as a public integration tool', () => {
    const tools = Reflect.getMetadata(
      'custom:tool',
      TiktokProvider.prototype,
    ) as Array<{ methodName: string }>;

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodName: 'creatorInfo' }),
      ]),
    );
  });

  it('returns only the sanitized creator identity and capabilities', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({
        data: {
          creator_avatar_url: 'https://example.test/avatar.jpg',
          creator_nickname: 'Plumeza Demo',
          creator_username: 'plumeza_demo',
          privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
          comment_disabled: false,
          duet_disabled: true,
          stitch_disabled: false,
          max_video_post_duration_sec: 180,
          access_token: 'must-not-leak',
        },
      }),
    } as Response);

    await expect(provider.creatorInfo('secret-token')).resolves.toEqual({
      creatorAvatarUrl: 'https://example.test/avatar.jpg',
      creatorNickname: 'Plumeza Demo',
      creatorUsername: 'plumeza_demo',
      privacyLevelOptions: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
      commentDisabled: false,
      duetDisabled: true,
      stitchDisabled: false,
      maxVideoPostDurationSeconds: 180,
    });
  });

  it('fails closed when optional capability flags are absent', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({ data: {} }),
    } as Response);

    await expect(provider.creatorInfo('secret-token')).resolves.toEqual({
      creatorAvatarUrl: '',
      creatorNickname: '',
      creatorUsername: '',
      privacyLevelOptions: [],
      commentDisabled: true,
      duetDisabled: true,
      stitchDisabled: true,
      maxVideoPostDurationSeconds: 0,
    });
  });

  it('raises a refresh-token error when TikTok reports an invalid access token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({
        data: {},
        error: { code: 'access_token_invalid', message: 'expired' },
      }),
    } as Response);

    await expect(provider.creatorInfo('expired-token')).rejects.toMatchObject({
      type: 'refresh_token',
    });
  });
});

describe('TiktokProvider publishing', () => {
  const postDetails = [
    {
      id: 'post-1',
      message: 'Private validation post',
      media: [{ path: 'https://media.example.test/uploads/video.mp4' }],
      settings: {
        content_posting_method: 'DIRECT_POST',
        privacy_level: 'SELF_ONLY',
        comment: false,
        duet: false,
        stitch: false,
      },
    },
  ] as any;
  const integration = { profile: 'creator-name' } as any;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function response(payload: unknown) {
    return { json: async () => payload } as Response;
  }

  it('rejects a successful init response without a publish_id', async () => {
    const provider = new TiktokProvider();
    jest.spyOn(provider, 'fetch').mockResolvedValue(response({ data: {} }));

    await expect(
      provider.post('creator-id', 'secret-token', postDetails, integration),
    ).rejects.toThrow('TikTok returned an invalid publication response');
  });

  it('maps URL ownership errors without exposing the token or media URL', async () => {
    const provider = new TiktokProvider();
    jest.spyOn(provider, 'fetch').mockResolvedValue(
      response({
        data: {},
        error: {
          code: 'url_ownership_unverified',
          message: 'unverified https://media.example.test/uploads/video.mp4',
        },
      }),
    );

    try {
      await provider.post(
        'creator-id',
        'secret-token',
        postDetails,
        integration,
      );
      throw new Error('expected publishing to fail');
    } catch (error) {
      expect(error).toMatchObject({
        message: expect.stringContaining('URL prefix is not verified'),
      });
      expect(JSON.stringify(error)).not.toContain('secret-token');
      expect(JSON.stringify(error)).not.toContain(
        'media.example.test/uploads/video.mp4',
      );
    }
  });

  it('times out after a bounded number of pending status checks', async () => {
    const provider = new TiktokProvider();
    const fetchSpy = jest
      .spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ data: { publish_id: 'publish-1' } }))
      .mockResolvedValue(response({ data: { status: 'PROCESSING' } }));

    await expect(
      provider.post('creator-id', 'secret-token', postDetails, integration),
    ).rejects.toThrow('TikTok publication status timed out');
    expect(fetchSpy).toHaveBeenCalledTimes(31);
  });

  it('returns success when TikTok completes the publication', async () => {
    const provider = new TiktokProvider();
    jest
      .spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ data: { publish_id: 'publish-1' } }))
      .mockResolvedValueOnce(
        response({
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: ['video-1'],
          },
        }),
      );

    await expect(
      provider.post('creator-id', 'secret-token', postDetails, integration),
    ).resolves.toEqual([
      {
        id: 'post-1',
        releaseURL: 'https://www.tiktok.com/@creator-name/video/video-1',
        postId: 'video-1',
        status: 'success',
      },
    ]);
  });

  it('falls back to the publish id and profile URL when TikTok returns no usable public post id', async () => {
    const provider = new TiktokProvider();
    jest
      .spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ data: { publish_id: 'publish-1' } }))
      .mockResolvedValueOnce(
        response({
          data: {
            status: 'PUBLISH_COMPLETE',
            publicaly_available_post_id: [],
          },
        }),
      );

    await expect(
      provider.post('creator-id', 'secret-token', postDetails, integration),
    ).resolves.toEqual([
      {
        id: 'post-1',
        releaseURL: 'https://www.tiktok.com/@creator-name',
        postId: 'publish-1',
        status: 'success',
      },
    ]);
  });

  it('returns a sanitized failure when TikTok marks the publication FAILED', async () => {
    const provider = new TiktokProvider();
    jest
      .spyOn(provider, 'fetch')
      .mockResolvedValueOnce(response({ data: { publish_id: 'publish-1' } }))
      .mockResolvedValueOnce(
        response({
          data: { status: 'FAILED' },
          error: {
            code: 'video_pull_failed',
            message: 'private upstream data',
          },
        }),
      );

    try {
      await provider.post(
        'creator-id',
        'secret-token',
        postDetails,
        integration,
      );
      throw new Error('expected publishing to fail');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Failed to pull video from URL, please check the URL',
      });
      expect(JSON.stringify(error)).not.toContain('private upstream data');
    }
  });
});
