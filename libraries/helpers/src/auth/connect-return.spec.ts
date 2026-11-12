/** @jest-environment node */
import { connectOrigin, connectOrigins, readReturnContext, returnCookieName, safeConnectReturn, signReturnContext } from './connect-return';

beforeEach(() => { process.env.JWT_SECRET = 'test-only-secret'; process.env.CONNECT_RETURN_ORIGIN = 'https://app.plumeza.io'; });
afterEach(() => jest.useRealTimers());

describe('signed browser return context', () => {
  const target = 'https://app.plumeza.io/connect/link-token';
  it('recovers a branded return independently of Redis and browser auth', () => {
    expect(readReturnContext('state-a', signReturnContext('state-a', target))).toBe(target);
  });
  it('binds separate tabs to their own state without an auth credential', () => {
    const a = signReturnContext('state-a', target);
    expect(readReturnContext('state-b', a)).toBeUndefined();
    expect(returnCookieName('state-a')).not.toBe(returnCookieName('state-b'));
  });
  it('rejects tampering and expired context', () => {
    const cookie = signReturnContext('state-a', target);
    expect(readReturnContext('state-a', cookie+'bad')).toBeUndefined();
    jest.useFakeTimers(); jest.setSystemTime(Date.now()+25*3600000);
    expect(readReturnContext('state-a', cookie)).toBeUndefined();
  });
  it.each(['https://evil.example/connect/link','https://app.plumeza.io.evil.example/connect/link','https://app.plumeza.io/launches','https://app.plumeza.io/connect/link?success=linkedin-page','https://app.plumeza.io/connect/link#evil','javascript:alert(1)','https://user:password@app.plumeza.io/connect/link'])('refuses unsafe destination %s', url => {
    expect(() => safeConnectReturn(url)).toThrow();
  });
});

describe('allowed return origins', () => {
  const at = (origin: string) => `${origin}/connect/link-token`;
  it('keeps a single origin working as before', () => {
    process.env.CONNECT_RETURN_ORIGIN = 'https://app-one.example.com';
    expect(connectOrigin()).toBe('https://app-one.example.com');
    expect(safeConnectReturn(at('https://app-one.example.com'))).toBe(at('https://app-one.example.com'));
    expect(() => safeConnectReturn(at('https://app-two.example.com'))).toThrow();
  });
  it('accepts every origin in a comma-separated list', () => {
    process.env.CONNECT_RETURN_ORIGIN = 'https://app-one.example.com,https://app-two.example.com';
    expect(safeConnectReturn(at('https://app-one.example.com'))).toBe(at('https://app-one.example.com'));
    expect(safeConnectReturn(at('https://app-two.example.com'))).toBe(at('https://app-two.example.com'));
    expect(readReturnContext('state-a', signReturnContext('state-a', at('https://app-two.example.com')))).toBe(at('https://app-two.example.com'));
    expect(connectOrigin()).toBe('https://app-one.example.com');
  });
  it.each(['https://evil.example', 'https://app-two.example.com.evil.example', 'http://app-two.example.com', 'https://www.app-two.example.com'])('refuses unlisted origin %s', origin => {
    process.env.CONNECT_RETURN_ORIGIN = 'https://app-one.example.com,https://app-two.example.com';
    expect(() => safeConnectReturn(at(origin))).toThrow();
  });
  it('keeps every other check for listed origins', () => {
    process.env.CONNECT_RETURN_ORIGIN = 'https://app-one.example.com,https://app-two.example.com';
    for (const url of ['https://app-two.example.com/launches', 'https://app-two.example.com/connect/a/b', 'https://app-two.example.com/connect/link?x=1', 'https://app-two.example.com/connect/link#x', 'https://user:pw@app-two.example.com/connect/link'])
      expect(() => safeConnectReturn(url)).toThrow();
  });
  it('trims whitespace and ignores empty entries', () => {
    process.env.CONNECT_RETURN_ORIGIN = ' https://app-one.example.com , ,https://app-two.example.com/ ,';
    expect(connectOrigins()).toEqual(['https://app-one.example.com', 'https://app-two.example.com']);
    expect(safeConnectReturn(at('https://app-two.example.com'))).toBe(at('https://app-two.example.com'));
  });
  it('treats a blank value as unset', () => {
    process.env.CONNECT_RETURN_ORIGIN = ' , ';
    expect(connectOrigin()).toBeUndefined();
    expect(() => safeConnectReturn(at('https://app-one.example.com'))).toThrow();
  });
  it.each(['ftp://bad.example.com', 'http://bad.example.com', 'https://bad.example.com/path', 'not a url'])('skips the invalid entry %s and keeps the valid ones', bad => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.CONNECT_RETURN_ORIGIN = `https://app-one.example.com,${bad},https://app-two.example.com`;
    expect(connectOrigins()).toEqual(['https://app-one.example.com', 'https://app-two.example.com']);
    expect(safeConnectReturn(at('https://app-two.example.com'))).toBe(at('https://app-two.example.com'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(bad));
    warn.mockRestore();
  });
  it('warns once per invalid entry, not on every request', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.CONNECT_RETURN_ORIGIN = 'https://app-one.example.com,https://once.example.com/x';
    connectOrigins(); connectOrigins(); connectOrigins();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('fails only when no valid origin remains', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.CONNECT_RETURN_ORIGIN = 'ftp://none-a.example.com, not a url';
    expect(() => connectOrigins()).toThrow('Invalid connect return origin');
    expect(() => safeConnectReturn(at('https://app-one.example.com'))).toThrow();
    // The fallback used by error pages never throws.
    expect(connectOrigin()).toBeUndefined();
    warn.mockRestore();
  });
});
