/** @jest-environment node */
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { signReturnContext, returnCookieName } from '@gitroom/helpers/auth/connect-return';
jest.mock('@gitroom/helpers/utils/internal.fetch', () => ({ internalFetch: jest.fn() }));
it('consumes only the current callback cookie while forwarding it to SSR', async () => {
  process.env.JWT_SECRET='test-only';process.env.CONNECT_RETURN_ORIGIN='https://app.plumeza.io';
  const signed=signReturnContext('current','https://app.plumeza.io/connect/test-link');
  const current=returnCookieName('current');const other=returnCookieName('other');
  const request=new NextRequest('https://postiz.example/integrations/social/linkedin-page?state=current', {headers:{cookie:`${current}=${signed}; ${other}=signed-other`, 'x-postiz-connect-return':'https://evil.example/connect/forged'}});
  const response=await proxy(request);
  expect(response.cookies.get(current)?.maxAge).toBe(0);
  expect(response.cookies.has(other)).toBe(false);
  expect(response.headers.get('x-middleware-request-x-postiz-connect-return')).toBe('https://app.plumeza.io/connect/test-link');
});

it('strips forged internal return headers when no signed callback context exists',async()=>{
 const response=await proxy(new NextRequest('https://postiz.example/integrations/social/linkedin-page?state=invalid',{headers:{'x-postiz-connect-return':'https://evil.example/connect/forged'}}));
 expect(response.headers.get('x-middleware-request-x-postiz-connect-return')).toBeNull();
});
