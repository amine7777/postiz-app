/** @jest-environment node */
import { readReturnContext, returnCookieName, safeConnectReturn, signReturnContext } from './connect-return';

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
