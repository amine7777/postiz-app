import React from 'react';
import { act } from '@testing-library/react';
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

const response = (status: number, body: unknown) => ({ status, json: async () => body });
const callback = { code: 'test-code', state: 'test-state' };
const returnURL = 'https://app.plumeza.io/connect/test-link';
const fallbackReturnURL = 'https://app.plumeza.io/connect/error';
const receipt = 'aa178550-cdb0-49b2-b612-35c57443f8a2';
const selection = { id: 'pending-integration', inBetweenSteps: true, pages: [] as unknown[], returnURL, flow: 'external' };
const props = { provider:'linkedin-page', searchParams:callback, logged:true, brandedReturnURL:returnURL, fallbackReturnURL };
async function showSelection(logged = true) {
 mockFetch.mockResolvedValueOnce(response(201, selection));
 render(<ContinueIntegration {...props} logged={logged} />);
 await screen.findByRole('button',{name:'Save'});
}
beforeEach(()=>{mockFetch.mockReset();mockPush.mockReset();globalThis.fetch=mockFetch as any;});
afterEach(()=>{cleanup();jest.useRealTimers();});

describe('branded OAuth outcomes',()=>{
 it.each([true,false])('returns to Plumeza after saved page with logged=%s',async logged=>{
  await showSelection(logged);mockFetch.mockResolvedValueOnce(response(201,{flow:'external',receipt,returnURL,id:'saved'}));
  fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(mockPush).toHaveBeenCalled());
  const url=new URL(mockPush.mock.calls[0][0]);expect(url.origin).toBe('https://app.plumeza.io');expect(url.searchParams.get('status')).toBe('connected');expect(url.searchParams.get('receipt')).toBe(receipt);expect(url.searchParams.has('success')).toBe(false);
  expect(mockFetch.mock.calls[1][0]).toBe('/api/integrations/public/provider/pending-integration/connect');
 });
 it.each([400,401,403,409,410,412,500])('returns initial HTTP%s errors to Plumeza without Postiz auth interception',async status=>{
  mockFetch.mockResolvedValueOnce(response(status,{code:'SESSION_EXPIRED',message:'raw token=secret'}));render(<ContinueIntegration {...props}/>);
  await waitFor(()=>expect(mockPush).toHaveBeenCalled());const url=new URL(mockPush.mock.calls[0][0]);expect(url.pathname).toBe('/connect/test-link');expect(url.searchParams.get('status')).toBe('error');expect(url.searchParams.get('code')).toBe('SESSION_EXPIRED');expect(url.toString()).not.toContain('secret');expect(mockFetch).toHaveBeenCalledTimes(1);
 });
 it('includes a stalled response body in the callback deadline',async()=>{
  jest.useFakeTimers();
  mockFetch.mockImplementationOnce(async(_url:any,options:any)=>({status:201,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))))}));
  render(<ContinueIntegration {...props}/>);
  await act(async()=>{await Promise.resolve();});
  await act(async()=>{jest.advanceTimersByTime(30001);});
  expect(new URL(mockPush.mock.calls[0][0]).searchParams.get('code')).toBe('CONNECTION_FAILED');
 });
 it('uses a branded fallback if Redis context and cookies have expired',async()=>{
  mockFetch.mockResolvedValueOnce(response(410,{code:'SESSION_EXPIRED'}));render(<ContinueIntegration {...props} brandedReturnURL={undefined}/>);
  await waitFor(()=>expect(mockPush).toHaveBeenCalled());expect(new URL(mockPush.mock.calls[0][0]).pathname).toBe('/connect/error');
 });
 it('handles provider denial before attempting an exchange',async()=>{
  render(<ContinueIntegration {...props} searchParams={{state:'test-state',error:'access_denied'}}/>);
  await waitFor(()=>expect(mockPush).toHaveBeenCalled());expect(mockFetch).not.toHaveBeenCalled();expect(new URL(mockPush.mock.calls[0][0]).searchParams.get('code')).toBe('PROVIDER_REJECTED');
 });
 it('returns network failure instead of leaving an unresolved loading screen',async()=>{
  mockFetch.mockRejectedValueOnce(new Error('network failed'));render(<ContinueIntegration {...props}/>);
  await waitFor(()=>expect(mockPush).toHaveBeenCalled());expect(new URL(mockPush.mock.calls[0][0]).searchParams.get('code')).toBe('CONNECTION_FAILED');
 });
 it.each(['server','network'])('returns save %s failure with no success marker',async kind=>{
  await showSelection();if(kind==='network')mockFetch.mockRejectedValueOnce(new Error('network'));else mockFetch.mockResolvedValueOnce(response(400,{code:'SAVE_FAILED'}));
  fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(mockPush).toHaveBeenCalled());const url=new URL(mockPush.mock.calls[0][0]);expect(url.searchParams.get('code')).toBe('SAVE_FAILED');expect(url.searchParams.has('success')).toBe(false);expect(url.pathname).not.toBe('/launches');
 });
 it('does not claim success without a server receipt',async()=>{
  await showSelection();mockFetch.mockResolvedValueOnce(response(201,{flow:'external',id:'saved'}));fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(mockPush).toHaveBeenCalled());expect(new URL(mockPush.mock.calls[0][0]).searchParams.get('code')).toBe('RESULT_MISSING');
 });
 it('allows an explicitly native successful connection to retain Postiz navigation',async()=>{
  mockFetch.mockResolvedValueOnce(response(201,{id:'saved',flow:'native',inBetweenSteps:false}));render(<ContinueIntegration provider="linkedin-page" searchParams={callback} logged/>);await waitFor(()=>expect(mockPush).toHaveBeenCalled());expect(mockPush.mock.calls[0][0]).toMatch(/^\/launches\?/);
 });
 it('does not automatically redirect a native error just because auth exists',async()=>{
  mockFetch.mockResolvedValueOnce(response(500,{}));render(<ContinueIntegration provider="linkedin-page" searchParams={callback} logged/>);await screen.findByText('Could not connect channel. Please start a new connection.');expect(mockPush).not.toHaveBeenCalled();
 });
});
