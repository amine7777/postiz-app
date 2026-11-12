import { HttpException } from '@nestjs/common';

/** Keep native Postiz OAuth disabled until the provider is approved globally. */
export function assertNativeYoutubeOAuthEnabled(integration: string): void {
  assertYoutubeOAuthEnabled(integration, false);
}

/** Allow the scoped Plumeza link while rejecting native and generic callbacks. */
export function assertYoutubeOAuthCallbackEnabled(
  integration: string,
  context?: { provider?: string; providerScoped?: boolean }
): void {
  assertYoutubeOAuthEnabled(
    integration,
    context?.providerScoped === true &&
      context.provider?.trim().toLowerCase() === 'youtube'
  );
}

function assertYoutubeOAuthEnabled(integration: string, providerScoped: boolean): void {
  if (
    integration.trim().toLowerCase() === 'youtube' &&
    process.env.POSTIZ_YOUTUBE_OAUTH_ENABLED !== 'true' &&
    !providerScoped
  ) {
    throw new HttpException(
      { msg: 'YouTube OAuth is not enabled' },
      403
    );
  }
}
