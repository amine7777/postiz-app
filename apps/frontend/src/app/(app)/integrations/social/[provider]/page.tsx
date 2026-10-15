import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';
import { cookies, headers } from 'next/headers';
import { connectOrigin, readReturnContext, returnCookieName } from '@gitroom/helpers/auth/connect-return';

export const dynamic = 'force-dynamic';

export default async function Page(
  props: {
    params: Promise<{
      provider: string;
    }>;
    searchParams: Promise<any>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    provider
  } = params;

  const jar = await cookies();
  const state = typeof searchParams.state === 'string' ? searchParams.state : typeof searchParams.oauth_token === 'string' ? searchParams.oauth_token : '';
  const brandedReturnURL = (await headers()).get('x-postiz-connect-return') || readReturnContext(state, jar.get(returnCookieName(state))?.value);
  const origin = connectOrigin();
  return <ContinueIntegration searchParams={searchParams} provider={provider} logged={!!jar.get('auth')} brandedReturnURL={brandedReturnURL} fallbackReturnURL={origin ? `${origin}/connect/error` : undefined} />;
}
