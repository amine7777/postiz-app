import { LinkedinPageProvider } from './linkedin.page.provider';
import { NotEnoughScopes, ProviderConnectionError } from '../social.abstract';

describe('LinkedinPageProvider authentication', () => {
  const provider = new LinkedinPageProvider();
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://postiz.example';
    process.env.LINKEDIN_PAGE_CLIENT_ID = 'page-client';
    process.env.LINKEDIN_PAGE_CLIENT_SECRET = 'page-secret';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('accepts a successful token response without scope and loads administered pages through the current API', async () => {
    const fetchMock = (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          elements: [{ organizationTarget: 'urn:li:organization:123' }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          localizedName: 'Plumeza',
          vanityName: 'plumeza',
        }),
      } as Response);

    await expect(
      provider.authenticate({ code: 'authorization-code', codeVerifier: '' })
    ).resolves.toMatchObject({
      id: '123',
      accessToken: 'token',
      name: 'Plumeza',
      username: 'plumeza',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED'
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.linkedin.com/rest/organizations/123'
    );
  });

  it('rejects a token that explicitly omits a required scope', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'token',
        expires_in: 3600,
        scope: 'rw_organization_admin w_organization_social',
      }),
    } as Response);

    await expect(
      provider.authenticate({ code: 'authorization-code', codeVerifier: '' })
    ).rejects.toBeInstanceOf(NotEnoughScopes);
  });

  it('keeps available pages when one organization lookup fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          elements: [
            { organizationTarget: 'urn:li:organization:123' },
            { organizationTarget: 'urn:li:organization:456' },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'not found' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 456,
          localizedName: 'Available page',
          vanityName: 'available-page',
        }),
      } as Response);

    await expect(provider.companies('token')).resolves.toEqual([
      expect.objectContaining({ id: '456', name: 'Available page' }),
    ]);
  });

  it('reports a failed token exchange as an authentication failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    } as Response);

    await expect(
      provider.authenticate({ code: 'authorization-code', codeVerifier: '' })
    ).rejects.toMatchObject({
      name: 'ProviderConnectionError',
      stage: 'token_exchange',
      status: 400,
    });
  });

  it('retries transient organization lookup failures', async () => {
    const cancel = jest.fn(async () => undefined);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        body: { cancel },
        json: async () => ({ message: 'temporarily unavailable' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ elements: [] }),
      } as Response);

    await expect(provider.companies('token')).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the final status after transient organization retries are exhausted', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'rate limited' }),
    } as Response);

    await expect(provider.companies('token')).rejects.toMatchObject({
      name: 'ProviderConnectionError',
      stage: 'organization_acl',
      status: 429,
    } satisfies Partial<ProviderConnectionError>);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
