'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HttpStatusCode } from 'axios';
import { useRouter } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import { continueProviderList } from '@gitroom/frontend/components/new-launch/providers/continue-provider/list';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useVariables } from '@gitroom/react/helpers/variable.context';

interface TwoStepState {
  integrationId: string;
  onboarding: boolean;
  pages: any[];
  returnURL?: string;
}

interface SuccessState {
  message: string;
}

export const ContinueIntegration: FC<{
  provider: string;
  searchParams: any;
  logged: boolean;
  brandedReturnURL?: string;
  fallbackReturnURL?: string;
}> = (props) => {
  const { provider, searchParams, logged, brandedReturnURL, fallbackReturnURL } = props;
  const { push } = useRouter();
  const t = useT();
  const { extensionId, backendUrl } = useVariables();
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [twoStepState, setTwoStepState] = useState<TwoStepState | null>(null);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const started = useRef(false);
  // Public OAuth callbacks must not run the authenticated fetch interceptor:
  // a stale Postiz cookie must neither redirect to /auth nor leave a pending promise.
  const fetch = async (path: string, options: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await globalThis.fetch(`${backendUrl}${path}`, {
        ...options, credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      });
      const data = await response.json();
      return { status: response.status, data };
    } finally { clearTimeout(timeout); }
  };
  const fail = (code: string, data: any = {}, returnURL?: string) => {
    const base = brandedReturnURL || returnURL || fallbackReturnURL;
    if (base) {
      const destination = new URL(base, window.location.origin);
      // A callback failure can never carry the legacy success marker.
      ['success', 'added', 'msg', 'status', 'receipt', 'code', 'requestId', 'onboarding'].forEach(key => destination.searchParams.delete(key));
      destination.searchParams.set('status', 'error');
      destination.searchParams.set('provider', provider);
      const allowed = ['SESSION_EXPIRED', 'PROVIDER_REJECTED', 'SAVE_FAILED', 'CONNECTION_FAILED', 'INVALID_ATTEMPT', 'RESULT_MISSING', 'CONNECTION_NOT_ALLOWED'];
      destination.searchParams.set('code', allowed.includes(code) ? code : 'CONNECTION_FAILED');
      if (typeof data.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(data.requestId)) destination.searchParams.set('requestId', data.requestId);
      push(destination.toString());
      return;
    }
    setErrorMessage('Could not connect channel. Please start a new connection.');
    setError(true);
  };
  const navigateOrShow = (path: string, returnURL: string | undefined, message: string, receipt?: string, flow?: string) => {
    if (brandedReturnURL || flow === 'external') {
      const base = brandedReturnURL || returnURL || fallbackReturnURL;
      if (!base || !receipt) return fail('RESULT_MISSING', {}, base);
      const destination = new URL(base, window.location.origin);
      ['success', 'added', 'msg', 'code', 'requestId', 'onboarding'].forEach(key => destination.searchParams.delete(key));
      destination.searchParams.set('status', 'connected');
      destination.searchParams.set('provider', provider);
      destination.searchParams.set('receipt', receipt);
      push(destination.toString());
    } else if (returnURL) {
      const destination = new URL(returnURL, window.location.origin);
      new URLSearchParams(path.split('?')[1] || '').forEach((value, key) => destination.searchParams.set(key, value));
      push(destination.toString());
    } else if (flow === 'native' && logged) push(path);
    else if (fallbackReturnURL) fail('RESULT_MISSING');
    else setSuccessState({ message });
  };
  const modifiedParams = useMemo(() => {
    if (provider === 'mewe') {
      return {
        state: searchParams.state || '',
        code: searchParams.loginRequestToken || '',
        refresh: searchParams.refresh || '',
      };
    }
    if (provider === 'x') {
      return {
        state: searchParams.oauth_token || '',
        code: searchParams.oauth_verifier || '',
        refresh: searchParams.refresh || '',
      };
    }

    if (provider === 'vk') {
      return {
        ...searchParams,
        state: searchParams.state || '',
        code: searchParams.code + '&&&&' + searchParams.device_id,
      };
    }

    if (provider === 'mewe') {
      const hash =
        typeof window !== 'undefined' ? window.location.hash.substring(1) : '';
      const hashParams = new URLSearchParams(hash);
      return {
        state: hashParams.get('state') || searchParams.state || '',
        code: hashParams.get('loginRequestToken') || '',
        refresh: searchParams.refresh || '',
      };
    }

    return searchParams;
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      if (searchParams.error) { fail('PROVIDER_REJECTED'); return; }
      const timezone = String(dayjs.tz().utcOffset());
      const response = await fetch(`/integrations/social-connect/${provider}`, {
        method: 'POST', body: JSON.stringify({ ...modifiedParams, timezone }),
      });
      const data = response.data;
      if (![HttpStatusCode.Ok, HttpStatusCode.Created].includes(response.status)) {
        fail(data.code || (response.status === 412 ? 'CONNECTION_NOT_ALLOWED' : 'CONNECTION_FAILED'), data);
        return;
      }
      const {
        inBetweenSteps,
        id,
        onboarding: resOnboarding,
        pages,
        returnURL,
        extensionToken,
        receipt, flow,
      } = data;
      const onboarding = resOnboarding || searchParams.onboarding === 'true';

      // Store refresh token in extension for background cookie refresh
      if (
        extensionToken &&
        extensionId &&
        typeof chrome !== 'undefined' &&
        chrome?.runtime?.sendMessage
      ) {
        try {
          chrome.runtime.sendMessage(
            extensionId,
            {
              type: 'STORE_REFRESH_TOKEN',
              provider,
              integrationId: id,
              jwt: extensionToken,
              backendUrl,
            },
            () => {}
          );
        } catch {
          // Silently ignore — extension may not be available
        }
      }

      // If it's a two-step provider, show the selection UI inline
      if (inBetweenSteps && !searchParams.refresh) {
        setTwoStepState({
          integrationId: id,
          onboarding,
          pages: pages || [],
          returnURL,
        });
        return;
      }

      navigateOrShow(
        `/launches?added=${provider}&msg=Channel Updated${
          onboarding ? '&onboarding=true' : ''
        }`,
        returnURL,
        'Channel Updated', receipt, flow
      );
    })().catch(() => {
      fail('CONNECTION_FAILED');
    });
  }, []);

  const onSave = useCallback(
    async (data: any) => {
      if (!twoStepState) return;

      setIsSaving(true);
      setError(false);
      setErrorMessage(null);

      try {
        // social-connect resolves the organization from the OAuth state. Keep
        // that identity for page selection, even when a different Postiz
        // organization is logged in in this browser.
        const endpoint = `/integrations/public/provider/${twoStepState.integrationId}/connect`;

        const response = await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ ...modifiedParams, ...data }),
        });

        const saveData = response.data;

        if (![HttpStatusCode.Ok, HttpStatusCode.Created].includes(response.status)) {
          fail(saveData.code || 'SAVE_FAILED', saveData, twoStepState.returnURL);
          return;
        }
        // Prefer the returnURL from the save response (freshly read from Redis at
        // the final step) and fall back to the one captured on the first call —
        // so two-step providers (LinkedIn page, Facebook…) reliably redirect back.
        navigateOrShow(
          `/launches?added=${provider}&msg=Channel Added${
            twoStepState.onboarding ? '&onboarding=true' : ''
          }`,
          saveData?.returnURL || twoStepState.returnURL,
          'Channel Added', saveData.receipt, saveData.flow
        );
      } catch {
        fail('SAVE_FAILED', {}, twoStepState.returnURL);
      } finally {
        setIsSaving(false);
      }
    },
    [twoStepState, fetch, modifiedParams, provider, navigateOrShow]
  );

  const Provider = useMemo(() => {
    return (
      continueProviderList[provider as keyof typeof continueProviderList] ||
      null
    );
  }, [provider]);

  const providerDisplayName = useMemo(() => {
    const names: Record<string, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram',
      'linkedin-page': 'LinkedIn',
      youtube: 'YouTube',
      gmb: 'Google Business',
    };
    return names[provider] || provider;
  }, [provider]);

  // Success state for non-logged users without returnURL
  if (successState) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#612BD3] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-green-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-green-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('channel_connected', 'Channel Connected!')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {successState.message ||
              t(
                'channel_connected_description',
                `Your ${providerDisplayName} channel has been successfully connected. You can close this window now.`
              )}
          </div>
        </div>
      </div>
    );
  }

  // Show the two-step selection UI
  if (twoStepState && Provider) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#612BD3] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full max-w-[550px] mx-auto px-[20px]">
          <div className="bg-[#1A1919] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
            <div className="flex flex-col gap-[8px] text-center">
              <h1 className="text-[24px] font-semibold">
                {t('configure_your_channel', 'Configure Your Channel')}
              </h1>
              <p className="text-[14px] text-gray-400">
                {t(
                  'select_the_page_or_account',
                  `Select the ${providerDisplayName} page or account you want to connect.`
                )}
              </p>
            </div>

            {error && (
              <p role="alert" className="text-red-400">
                {errorMessage || 'Failed to save channel configuration'}
              </p>
            )}

            <IntegrationContext.Provider
              value={{
                date: newDayjs(),
                value: [],
                allIntegrations: [],
                integration: {
                  editor: 'normal',
                  additionalSettings: '',
                  display: '',
                  time: [{ time: 0 }],
                  id: twoStepState.integrationId,
                  type: '',
                  name: '',
                  picture: '',
                  inBetweenSteps: true,
                  changeNickName: false,
                  changeProfilePicture: false,
                  identifier: provider,
                },
              }}
            >
              <Provider
                onSave={onSave}
                existingId={[]}
                initialData={twoStepState.pages}
                isSaving={isSaving}
              />
            </IntegrationContext.Provider>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        {/* Background gradient decoration */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#612BD3] rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
        </div>

        <div className="relative z-10 text-center">
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('could_not_add_provider', 'Could not add provider')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {errorMessage ||
              t(
                'you_are_being_redirected_back',
                'An error occurred. Please try again.'
              )}
          </div>

        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
      {/* Background gradient decoration */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-[#612BD3] rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#FC69FF] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 text-center">
        <div className="text-[28px] font-semibold mb-[12px]">
          {t('adding_channel', 'Adding Channel')}
        </div>
        <div className="text-[16px] text-gray-400">
          {t('please_wait', 'Please wait while we connect your account...')}
        </div>
        {/* Loading spinner */}
        <div className="mt-[32px] flex justify-center">
          <div className="w-[48px] h-[48px] border-[3px] border-[#612BD3] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    </div>
  );
};
