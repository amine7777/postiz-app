import React from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ContinueIntegration } from './continue.integration';

const mockFetch = jest.fn<(...args: any[]) => Promise<any>>();
const mockPush = jest.fn<(path: string) => void>();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ backendUrl: '/api' }),
}));
jest.mock('@gitroom/frontend/components/layout/redirect', () => ({
  Redirect: (): null => null,
}));
jest.mock('@gitroom/frontend/components/layout/set.timezone', () => ({
  newDayjs: (): null => null,
}));
jest.mock('dayjs', () => ({
  __esModule: true,
  default: { tz: () => ({ utcOffset: () => 0 }) },
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({
    IntegrationContext: require('react').createContext({}),
  })
);
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/continue-provider/list',
  () => ({
    continueProviderList: {
      'linkedin-page': ({ onSave, isSaving }: any) => (
        <button
          disabled={isSaving}
          onClick={() => onSave({ page: 'page-selected' })}
        >
          Save
        </button>
      ),
    },
  })
);

const response = (status: number, body: unknown) => ({
  status,
  json: async () => body,
});
const callback = { code: 'test-code', state: 'test-state' };
const returnURL =
  'https://app.plumeza.io/connect/test-link?success=linkedin-page';
const selection = {
  id: 'pending-integration',
  inBetweenSteps: true,
  pages: [] as unknown[],
  returnURL,
};
async function showSelection(logged = true) {
  mockFetch.mockResolvedValueOnce(response(201, selection));
  render(
    <ContinueIntegration
      provider="linkedin-page"
      searchParams={callback}
      logged={logged}
    />
  );
  await screen.findByRole('button', { name: 'Save' });
}

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

describe('OAuth page selection', () => {
  it.each([true, false])(
    'keeps OAuth state identity when logged=%s',
    async (logged) => {
      await showSelection(logged);
      mockFetch.mockResolvedValueOnce(response(201, { success: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(mockPush).toHaveBeenCalled());
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        '/integrations/public/provider/pending-integration/connect',
        {
          method: 'POST',
          body: JSON.stringify({ ...callback, page: 'page-selected' }),
        }
      );
      const destination = new URL(mockPush.mock.calls[0][0]);
      expect(destination.origin).toBe('https://app.plumeza.io');
      expect(destination.searchParams.get('success')).toBe('linkedin-page');
      expect(destination.searchParams.get('added')).toBe('linkedin-page');
      expect(destination.searchParams.get('msg')).toBe('Channel Added');
    }
  );

  it('shows a save rejection and allows retry without repeating OAuth', async () => {
    await showSelection();
    mockFetch.mockResolvedValueOnce(
      response(404, { message: 'Integration not found' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Integration not found'
    );
    expect(mockPush).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
    mockFetch.mockResolvedValueOnce(response(201, { success: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('shows a network failure and releases the Save button', async () => {
    await showSelection();
    mockFetch.mockRejectedValueOnce(new Error('Network unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not save'
    );
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('prefers the final return URL and preserves its query and fragment', async () => {
    await showSelection();
    mockFetch.mockResolvedValueOnce(
      response(201, {
        success: true,
        returnURL:
          'https://app.plumeza.io/connect/final?success=linkedin-page&customer=test#done',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const destination = new URL(mockPush.mock.calls[0][0]);
    expect(destination.pathname).toBe('/connect/final');
    expect(destination.searchParams.get('success')).toBe('linkedin-page');
    expect(destination.searchParams.get('customer')).toBe('test');
    expect(destination.searchParams.get('added')).toBe('linkedin-page');
    expect(destination.hash).toBe('#done');
  });

  it('reports an initial connection failure instead of remaining on the spinner', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unavailable'));
    render(
      <ContinueIntegration
        provider="linkedin-page"
        searchParams={callback}
        logged={false}
      />
    );
    expect(
      await screen.findByText('Could not connect channel. Please try again.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('preserves the single-step callback return parameters', async () => {
    mockFetch.mockResolvedValueOnce(
      response(201, { id: 'channel', returnURL })
    );
    render(
      <ContinueIntegration
        provider="linkedin"
        searchParams={callback}
        logged={true}
      />
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    const destination = new URL(mockPush.mock.calls[0][0]);
    expect(destination.searchParams.get('success')).toBe('linkedin-page');
    expect(destination.searchParams.get('added')).toBe('linkedin');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
