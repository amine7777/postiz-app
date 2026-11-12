/** @jest-environment node */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { InstagramProvider } from './instagram.provider';
import { InstagramStandaloneProvider } from './instagram.standalone.provider';

// The analytics callers now pass the channel as the 4th (5th) argument. It
// must not end up as the Graph host in the URL.
describe('Instagram analytics with the channel passed by the caller', () => {
  const urls: string[] = [];
  const channel = { id: 'ch', organizationId: 'org' } as any;
  beforeEach(() => {
    urls.length = 0;
    (globalThis as any).fetch = jest.fn(async (url: any) => {
      urls.push(String(url));
      return { json: async () => ({ data: [] }) } as any;
    });
  });

  it('Instagram (Facebook login) still calls graph.facebook.com', async () => {
    const provider = new InstagramProvider();
    await provider.analytics('ig-1', 'token', 7, channel);
    await provider.postAnalytics('ig-1', 'token', 'post-1', 7, channel).catch(() => undefined);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('https://graph.facebook.com/')).toBe(true);
  });

  it('Instagram standalone still calls graph.instagram.com', async () => {
    const provider = new InstagramStandaloneProvider();
    await provider.analytics('ig-1', 'token', 7);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('https://graph.instagram.com/')).toBe(true);
  });
});
