import {
  AnalyticsData,
  AuthTokenDetails,
  ClientInformation,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import dayjs from 'dayjs';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { timer } from '@gitroom/helpers/utils/timer';
import { Integration } from '@prisma/client';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

export interface TikTokCreatorInfo {
  creatorAvatarUrl: string;
  creatorNickname: string;
  creatorUsername: string;
  privacyLevelOptions: Array<
    | 'PUBLIC_TO_EVERYONE'
    | 'MUTUAL_FOLLOW_FRIENDS'
    | 'FOLLOWER_OF_CREATOR'
    | 'SELF_ONLY'
  >;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSeconds: number;
}

const TIKTOK_PUBLISH_STATUS_MAX_ATTEMPTS = 30;
const TIKTOK_PUBLISH_STATUS_POLL_INTERVAL_MS = 10_000;
const TIKTOK_URL_OWNERSHIP_MESSAGE =
  'TikTok could not access the media because its URL prefix is not verified. Verify the Postiz uploads URL prefix in TikTok Developer Portal, then retry.';

@Rules(
  'TikTok can have one video or one picture or multiple pictures, it cannot be without an attachment',
)
export class TiktokProvider extends SocialAbstract implements SocialProvider {
  identifier = 'tiktok';
  name = 'Tiktok';
  isBetweenSteps = false;
  convertToJPEG = true;
  scopes = [
    'video.list',
    'user.info.basic',
    'video.publish',
    'video.upload',
    'user.info.profile',
    'user.info.stats',
  ];
  override maxConcurrentJob = 300;
  dto = TikTokDto;
  editor = 'normal' as const;
  maxLength() {
    return 2000;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Authentication/Authorization errors - require re-authentication
    if (body.indexOf('access_token_invalid') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'Access token invalid, please re-authenticate your TikTok account',
      };
    }

    if (body.indexOf('scope_not_authorized') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Missing required permissions, please re-authenticate with all scopes',
      };
    }

    if (body.indexOf('scope_permission_missed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Additional permissions required, please re-authenticate',
      };
    }

    // Rate limiting errors
    if (body.indexOf('rate_limit_exceeded') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok API rate limit exceeded, please try again later',
      };
    }

    if (body.indexOf('file_format_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'File format is invalid, please check video specifications',
      };
    }

    if (body.indexOf('app_version_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'In order to use the TikTok upload feature, you have to update your app to the latest version',
      };
    }

    if (body.indexOf('duration_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video duration is invalid, please check video specifications',
      };
    }

    if (body.indexOf('frame_rate_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video frame rate is invalid, please check video specifications',
      };
    }

    if (body.indexOf('video_pull_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to pull video from URL, please check the URL',
      };
    }

    if (body.indexOf('photo_pull_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to pull photo from URL, please check the URL',
      };
    }

    if (body.indexOf('spam_risk_user_banned_from_posting') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Account banned from posting, please check TikTok account status',
      };
    }

    if (body.indexOf('spam_risk_text') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok detected potential spam in the post text',
      };
    }

    if (body.indexOf('spam_risk_too_many_posts') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'TikTok says your daily post limit reached, please try again tomorrow',
      };
    }

    if (body.indexOf('spam_risk_too_many_pending_share') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'TikTok limit the maximum of pending posts to 5, TikTok limits you for now, please check your TikTok inbox at your TikTok mobile app and try again later',
      };
    }

    if (body.indexOf('spam_risk_user_banned_from_posting') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Account banned from posting, please check TikTok account status',
      };
    }

    if (body.indexOf('spam_risk') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok detected potential spam',
      };
    }

    if (body.indexOf('reached_active_user_cap') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Daily active user quota reached, please try again later',
      };
    }

    if (
      body.indexOf('unaudited_client_can_only_post_to_private_accounts') > -1
    ) {
      return {
        type: 'bad-body' as const,
        value: 'App not approved for public posting, contact support',
      };
    }

    if (body.indexOf('url_ownership_unverified') > -1) {
      return {
        type: 'bad-body' as const,
        value: TIKTOK_URL_OWNERSHIP_MESSAGE,
      };
    }

    if (body.indexOf('privacy_level_option_mismatch') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Privacy level mismatch, please check privacy settings',
      };
    }

    // Content/Format validation errors
    if (body.indexOf('invalid_file_upload') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid file format or specifications not met',
      };
    }

    if (body.indexOf('invalid_params') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid request parameters, please check content format',
      };
    }

    // Server errors
    if (body.indexOf('internal') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'There is a problem with TikTok servers, please try again later',
      };
    }

    // Generic TikTok API errors
    if (body.indexOf('picture_size_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video must be at least 720p, Picture must no exceed 1080p',
      };
    }

    if (body.indexOf('TikTok API error') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok API error, please try again',
      };
    }

    // Fall back to parent class error handling
    return undefined;
  }

  async refreshToken(
    refreshToken: string,
    clientCredentials?: { clientId: string; clientSecret: string },
  ): Promise<AuthTokenDetails> {
    const clientKey =
      clientCredentials?.clientId ?? process.env.TIKTOK_CLIENT_ID!;
    const clientSecret =
      clientCredentials?.clientSecret ?? process.env.TIKTOK_CLIENT_SECRET!;

    const value = {
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    const { access_token, refresh_token, ...all } = await (
      await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        body: new URLSearchParams(value).toString(),
      })
    ).json();

    const {
      data: {
        user: { avatar_url, display_name, open_id, username },
      },
    } = await (
      await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      )
    ).json();

    return {
      refreshToken: refresh_token,
      expiresIn: dayjs().add(23, 'hours').unix() - dayjs().unix(),
      accessToken: access_token,
      id: open_id.replace(/-/g, ''),
      name: display_name,
      picture: avatar_url || '',
      username: username,
    };
  }

  async generateAuthUrl(clientInformation?: ClientInformation) {
    const state = Math.random().toString(36).substring(2);
    const tiktokClientId =
      clientInformation?.client_id ?? process.env.TIKTOK_CLIENT_ID;

    return {
      url:
        'https://www.tiktok.com/v2/auth/authorize/' +
        `?client_key=${tiktokClientId}` +
        `&redirect_uri=${encodeURIComponent(
          `${
            process?.env?.FRONTEND_URL?.indexOf('https') === -1
              ? 'https://redirectmeto.com/'
              : ''
          }${process?.env?.FRONTEND_URL}/integrations/social/tiktok`,
        )}` +
        `&state=${state}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: state,
      state,
    };
  }

  async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation,
  ) {
    const tiktokClientId =
      clientInformation?.client_id ?? process.env.TIKTOK_CLIENT_ID!;
    const tiktokClientSecret =
      clientInformation?.client_secret ?? process.env.TIKTOK_CLIENT_SECRET!;

    const value = {
      client_key: tiktokClientId,
      client_secret: tiktokClientSecret,
      code: params.code,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
      redirect_uri: `${
        process?.env?.FRONTEND_URL?.indexOf('https') === -1
          ? 'https://redirectmeto.com/'
          : ''
      }${process?.env?.FRONTEND_URL}/integrations/social/tiktok`,
    };

    const { access_token, refresh_token, scope } = await (
      await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        body: new URLSearchParams(value).toString(),
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const {
      data: {
        user: { avatar_url, display_name, open_id, username },
      },
    } = await (
      await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        },
      )
    ).json();

    return {
      id: open_id.replace(/-/g, ''),
      name: display_name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: dayjs().add(23, 'hours').unix() - dayjs().unix(),
      picture: avatar_url,
      username: username,
    };
  }

  @Tool({
    description:
      'Get the current TikTok creator identity and Direct Post capabilities',
    dataSchema: [],
  })
  async creatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
    const response = await this.fetch(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Authorization: `Bearer ${accessToken}`,
        },
      },
      'tiktok-creator-info',
      0,
      true,
    );
    const payload = (await response.json()) as {
      data?: {
        creator_avatar_url?: string;
        creator_nickname?: string;
        creator_username?: string;
        privacy_level_options?: TikTokCreatorInfo['privacyLevelOptions'];
        comment_disabled?: boolean;
        duet_disabled?: boolean;
        stitch_disabled?: boolean;
        max_video_post_duration_sec?: number;
      };
      error?: { code?: string; message?: string };
    };
    if (payload.error?.code && payload.error.code !== 'ok') {
      const serialized = JSON.stringify(payload);
      const handled = this.handleErrors(serialized);
      if (handled?.type === 'refresh-token') {
        throw new RefreshToken(
          'tiktok-creator-info',
          serialized,
          '{}',
          handled.value,
        );
      }
      throw new BadBody(
        'tiktok-creator-info',
        serialized,
        '{}',
        handled?.value || payload.error.message || 'TikTok creator info failed',
      );
    }
    const data = payload.data ?? {};

    return {
      creatorAvatarUrl: data.creator_avatar_url ?? '',
      creatorNickname: data.creator_nickname ?? '',
      creatorUsername: data.creator_username ?? '',
      privacyLevelOptions: data.privacy_level_options ?? [],
      commentDisabled: data.comment_disabled ?? true,
      duetDisabled: data.duet_disabled ?? true,
      stitchDisabled: data.stitch_disabled ?? true,
      maxVideoPostDurationSeconds: data.max_video_post_duration_sec ?? 0,
    };
  }

  async maxVideoLength(accessToken: string) {
    const creatorInfo = await this.creatorInfo(accessToken);

    return {
      maxDurationSeconds: creatorInfo.maxVideoPostDurationSeconds,
    };
  }

  private async uploadedVideoSuccess(
    id: string,
    publishId: string,
    accessToken: string,
  ): Promise<{ url: string; id: string }> {
    for (
      let attempt = 1;
      attempt <= TIKTOK_PUBLISH_STATUS_MAX_ATTEMPTS;
      attempt += 1
    ) {
      let post: unknown;
      try {
        post = await (
          await this.fetch(
            'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                publish_id: publishId,
              }),
            },
            '',
            0,
            true,
          )
        ).json();
      } catch (error) {
        this.rethrowSanitizedTikTokError(error, 'tiktok-publish-status');
      }

      const payload = this.asTikTokPayload(post);
      if (payload.error?.code && payload.error.code !== 'ok') {
        this.throwTikTokPayloadError(
          'tiktok-publish-status',
          payload,
          'TikTok could not read the publication status',
        );
      }

      const status = payload.data?.status;
      const publicPostId = this.publicPostIdFrom(payload);

      if (status === 'SEND_TO_USER_INBOX') {
        return {
          url: 'https://www.tiktok.com/messages?lang=en',
          id: 'missing',
        };
      }

      if (status === 'PUBLISH_COMPLETE') {
        return {
          url: !publicPostId
            ? `https://www.tiktok.com/@${id}`
            : `https://www.tiktok.com/@${id}/video/${publicPostId}`,
          id: publicPostId || publishId,
        };
      }

      if (status === 'FAILED') {
        this.throwTikTokPayloadError(
          'tiktok-publish-status',
          payload,
          'TikTok could not publish this media',
        );
      }

      if (attempt < TIKTOK_PUBLISH_STATUS_MAX_ATTEMPTS) {
        await timer(TIKTOK_PUBLISH_STATUS_POLL_INTERVAL_MS);
      }
    }

    throw new BadBody(
      'tiktok-publish-status',
      '{}',
      '{}',
      'TikTok publication status timed out. Check TikTok before retrying.',
    );
  }

  private asTikTokPayload(payload: unknown): {
    data?: {
      publish_id?: unknown;
      status?: string;
      publicaly_available_post_id?: unknown;
    };
    error?: { code?: string; message?: string };
  } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    return payload as {
      data?: {
        publish_id?: unknown;
        status?: string;
        publicaly_available_post_id?: unknown;
      };
      error?: { code?: string; message?: string };
    };
  }

  private publicPostIdFrom(payload: {
    data?: { publicaly_available_post_id?: unknown };
  }): string | undefined {
    const ids = payload.data?.publicaly_available_post_id;
    if (!Array.isArray(ids)) return undefined;
    const id = ids.find(
      (candidate): candidate is string =>
        typeof candidate === 'string' && candidate.trim().length > 0,
    );
    return id?.trim();
  }

  private throwTikTokPayloadError(
    identifier: string,
    payload: unknown,
    fallbackMessage: string,
  ): never {
    const handled = this.handleErrors(JSON.stringify(payload));
    const message = handled?.value || fallbackMessage;
    if (handled?.type === 'refresh-token') {
      throw new RefreshToken(identifier, '{}', '{}', message);
    }
    throw new BadBody(identifier, '{}', '{}', message);
  }

  private rethrowSanitizedTikTokError(
    error: unknown,
    identifier: string,
  ): never {
    if (error instanceof RefreshToken) {
      throw new RefreshToken(
        identifier,
        '{}',
        '{}',
        error.message || 'TikTok authentication failed',
      );
    }
    if (error instanceof BadBody) {
      throw new BadBody(
        identifier,
        '{}',
        '{}',
        error.message || 'TikTok publish request failed',
      );
    }
    throw error;
  }

  private publishIdFrom(payload: unknown): string {
    const parsed = this.asTikTokPayload(payload);
    if (parsed.error?.code && parsed.error.code !== 'ok') {
      this.throwTikTokPayloadError(
        'tiktok-publish-init',
        parsed,
        'TikTok rejected the publication request',
      );
    }
    if (
      typeof parsed.data?.publish_id !== 'string' ||
      !parsed.data.publish_id.trim()
    ) {
      throw new BadBody(
        'tiktok-publish-init',
        '{}',
        '{}',
        'TikTok returned an invalid publication response',
      );
    }
    return parsed.data.publish_id;
  }

  private postingMethod(
    method: TikTokDto['content_posting_method'],
    isPhoto: boolean,
  ): string {
    switch (method) {
      case 'UPLOAD':
        return isPhoto ? '/content/init/' : '/inbox/video/init/';
      case 'DIRECT_POST':
      default:
        return isPhoto ? '/content/init/' : '/video/init/';
    }
  }

  private buildTikokPostInfoBody(firstPost: PostDetails<TikTokDto>) {
    const isPhoto = (firstPost?.media?.[0]?.path?.indexOf('mp4') || -1) === -1;
    const method = firstPost?.settings?.content_posting_method;

    if (method === 'DIRECT_POST') {
      return {
        post_info: {
          ...(isPhoto && firstPost.settings.title
            ? { title: firstPost.settings.title.slice(0, 90) }
            : {}),
          ...(!isPhoto && firstPost.message
            ? { title: firstPost.message }
            : {}),
          ...(isPhoto ? { description: firstPost.message } : {}),
          privacy_level:
            firstPost.settings.privacy_level || 'PUBLIC_TO_EVERYONE',
          ...(isPhoto
            ? {}
            : { disable_duet: !firstPost.settings.duet || false }),
          disable_comment: !firstPost.settings.comment || false,
          ...(isPhoto
            ? {}
            : { disable_stitch: !firstPost.settings.stitch || false }),
          ...(isPhoto
            ? {}
            : { is_aigc: firstPost.settings.video_made_with_ai || false }),
          brand_content_toggle:
            firstPost.settings.brand_content_toggle || false,
          brand_organic_toggle:
            firstPost.settings.brand_organic_toggle || false,
          ...(isPhoto
            ? {
                auto_add_music: firstPost.settings.autoAddMusic === 'yes',
              }
            : {}),
        },
      };
    }

    return {
      post_info: {
        ...(isPhoto && firstPost.settings.title
          ? { title: firstPost.settings.title }
          : {}),
        ...(!isPhoto && firstPost.message ? { title: firstPost.message } : {}),
        ...(isPhoto ? { description: firstPost.message } : {}),
      },
    };
  }

  private buildTikokSourceInfoBody(firstPost: PostDetails<TikTokDto>) {
    const isPhoto = (firstPost?.media?.[0]?.path?.indexOf('mp4') || -1) === -1;

    if (isPhoto) {
      return {
        post_mode:
          firstPost?.settings?.content_posting_method === 'DIRECT_POST'
            ? 'DIRECT_POST'
            : 'MEDIA_UPLOAD',
        media_type: 'PHOTO',
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: firstPost.media?.map((p) => p.path),
        },
      };
    }

    return {
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: firstPost?.media?.[0]?.path!,
        ...(firstPost?.media?.[0]?.thumbnailTimestamp!
          ? {
              video_cover_timestamp_ms:
                firstPost?.media?.[0]?.thumbnailTimestamp!,
            }
          : {}),
      },
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<TikTokDto>[],
    integration: Integration,
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const isPhoto = (firstPost?.media?.[0]?.path?.indexOf('mp4') || -1) === -1;

    let initPayload: unknown;
    try {
      initPayload = await (
        await this.fetch(
          `https://open.tiktokapis.com/v2/post/publish${this.postingMethod(
            firstPost.settings.content_posting_method,
            (firstPost?.media?.[0]?.path?.indexOf('mp4') || -1) === -1,
          )}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              ...this.buildTikokPostInfoBody(firstPost),
              ...this.buildTikokSourceInfoBody(firstPost),
            }),
          },
        )
      ).json();
    } catch (error) {
      this.rethrowSanitizedTikTokError(error, 'tiktok-publish-init');
    }
    const publish_id = this.publishIdFrom(initPayload);

    const { url, id: videoId } = await this.uploadedVideoSuccess(
      integration.profile!,
      publish_id,
      accessToken,
    );

    return [
      {
        id: firstPost.id,
        releaseURL: url,
        postId: String(videoId),
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number,
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Get user stats (follower_count, following_count, likes_count, video_count)
      const userStatsResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const userStatsData = await userStatsResponse.json();
      const userStats = userStatsData?.data?.user;

      const result: AnalyticsData[] = [];

      if (userStats) {
        if (userStats.follower_count !== undefined) {
          result.push({
            label: 'Followers',
            percentageChange: 0,
            data: [{ total: String(userStats.follower_count), date: today }],
          });
        }

        if (userStats.following_count !== undefined) {
          result.push({
            label: 'Following',
            percentageChange: 0,
            data: [{ total: String(userStats.following_count), date: today }],
          });
        }

        if (userStats.likes_count !== undefined) {
          result.push({
            label: 'Total Likes',
            percentageChange: 0,
            data: [{ total: String(userStats.likes_count), date: today }],
          });
        }

        if (userStats.video_count !== undefined) {
          result.push({
            label: 'Videos',
            percentageChange: 0,
            data: [{ total: String(userStats.video_count), date: today }],
          });
        }
      }

      // Get recent videos and aggregate their stats
      const videoListResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ max_count: 20 }),
        },
      );

      const videoListData = await videoListResponse.json();
      const videos = videoListData?.data?.videos;

      if (videos && videos.length > 0) {
        const videoIds = videos.map((v: { id: string }) => v.id);

        // Query video details to get engagement metrics
        const videoQueryResponse = await this.fetch(
          'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              filters: { video_ids: videoIds },
            }),
          },
        );

        const videoQueryData = await videoQueryResponse.json();
        const videoDetails = videoQueryData?.data?.videos;

        if (videoDetails && videoDetails.length > 0) {
          let totalViews = 0;
          let totalLikes = 0;
          let totalComments = 0;
          let totalShares = 0;

          for (const video of videoDetails) {
            totalViews += video.view_count || 0;
            totalLikes += video.like_count || 0;
            totalComments += video.comment_count || 0;
            totalShares += video.share_count || 0;
          }

          result.push({
            label: 'Views',
            percentageChange: 0,
            data: [{ total: String(totalViews), date: today }],
          });

          result.push({
            label: 'Recent Likes',
            percentageChange: 0,
            data: [{ total: String(totalLikes), date: today }],
          });

          result.push({
            label: 'Recent Comments',
            percentageChange: 0,
            data: [{ total: String(totalComments), date: today }],
          });

          result.push({
            label: 'Recent Shares',
            percentageChange: 0,
            data: [{ total: String(totalShares), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching TikTok analytics:', err);
      return [];
    }
  }

  async missing(
    id: string,
    accessToken: string,
  ): Promise<{ id: string; url: string }[]> {
    try {
      const videoListResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,cover_image_url,title',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ max_count: 20 }),
        },
      );

      const videoListData = await videoListResponse.json();
      const videos = videoListData?.data?.videos;

      if (!videos || videos.length === 0) {
        return [];
      }

      return videos.map((v: { id: string; cover_image_url: string }) => ({
        id: String(v.id),
        url: v.cover_image_url,
      }));
    } catch (err) {
      console.error('Error fetching TikTok missing content:', err);
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number,
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    if (postId.indexOf('v_pub_url') > -1) {
      const post = await (
        await this.fetch(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              publish_id: postId,
            }),
          },
          '',
          0,
          true,
        )
      ).json();

      if (!post?.data?.publicaly_available_post_id?.[0]) {
        return [];
      }

      postId = post.data.publicaly_available_post_id[0];
    }

    try {
      // Query video details using the video ID
      const response = await this.fetch(
        'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            filters: {
              video_ids: [postId],
            },
          }),
        },
      );

      const data = await response.json();
      const video = data?.data?.videos?.[0];

      if (!video) {
        return [];
      }

      const result: AnalyticsData[] = [];

      if (video.view_count !== undefined) {
        result.push({
          label: 'Views',
          percentageChange: 0,
          data: [{ total: String(video.view_count), date: today }],
        });
      }

      if (video.like_count !== undefined) {
        result.push({
          label: 'Likes',
          percentageChange: 0,
          data: [{ total: String(video.like_count), date: today }],
        });
      }

      if (video.comment_count !== undefined) {
        result.push({
          label: 'Comments',
          percentageChange: 0,
          data: [{ total: String(video.comment_count), date: today }],
        });
      }

      if (video.share_count !== undefined) {
        result.push({
          label: 'Shares',
          percentageChange: 0,
          data: [{ total: String(video.share_count), date: today }],
        });
      }

      return result;
    } catch (err) {
      console.error('Error fetching TikTok post analytics:', err);
      return [];
    }
  }
}
