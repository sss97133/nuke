// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type OtpResult = { error: { message: string } | null };
type RpcResult = { data: { ok: boolean; reason?: string } | null; error: { message: string } | null };

const fixture = vi.hoisted(() => ({
  otpResult: null as OtpResult | null,
  otpHeld: null as Promise<OtpResult> | null,
  otpCalls: [] as unknown[],
  rpcCalls: [] as { name: string; args: unknown }[],
  rpcResult: null as RpcResult | null,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
      signInWithOtp: vi.fn((args: unknown) => {
        fixture.otpCalls.push(args);
        return fixture.otpHeld ?? Promise.resolve(fixture.otpResult);
      }),
      verifyOtp: vi.fn(() => Promise.resolve({ data: { user: null }, error: { message: 'Token has expired or is invalid' } })),
    },
    rpc: vi.fn((name: string, args: unknown) => {
      fixture.rpcCalls.push({ name, args });
      return Promise.resolve(fixture.rpcResult);
    }),
    from: vi.fn(() => ({ insert: () => Promise.resolve({}) })),
  },
}));

import DataRoomGate from './DataRoomGate';

const TWILIO_20003 = 'Error sending confirmation OTP to provider: Authenticate More information: https://www.twilio.com/docs/errors/20003';
const TWILIO_BAD_TO = "Error sending confirmation OTP to provider: Invalid 'To' Phone Number More information: https://www.twilio.com/docs/errors/21211";

let root: Root;
let container: HTMLDivElement;
const onAccessGranted = vi.fn();

async function render() {
  await act(async () => {
    root.render(<DataRoomGate organizationId="org-1" organizationName="Test Org" onAccessGranted={onAccessGranted} />);
  });
}
async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
const input = (type: string) => container.querySelector(`input[type="${type}"]`) as HTMLInputElement | null;
const tab = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.otpResult = { error: null };
  fixture.otpHeld = null;
  fixture.otpCalls = [];
  fixture.rpcCalls = [];
  fixture.rpcResult = { data: { ok: true }, error: null };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

it('moves the visitor to the email tab when the SMS provider rejects the send (Twilio 20003)', async () => {
  fixture.otpResult = { error: { message: TWILIO_20003 } };
  await render();
  await changeInput(input('tel')!, '(702) 555-0100');
  await submit();

  expect(fixture.otpCalls).toEqual([{ phone: '+17025550100' }]);
  expect(input('tel')).toBeNull();
  expect(input('email')).not.toBeNull();
  expect(container.textContent).toMatch(/can’t send text codes right now/);
  expect(container.textContent).not.toMatch(/twilio|20003|authenticate/i);

  await changeInput(input('email')!, 'visitor@example.com');
  await submit();
  expect(container.textContent).toMatch(/NON-DISCLOSURE AGREEMENT/);
});

it('keeps the phone tab and explains a bad number without switching methods', async () => {
  fixture.otpResult = { error: { message: TWILIO_BAD_TO } };
  await render();
  await changeInput(input('tel')!, '123');
  await submit();

  expect(input('tel')).not.toBeNull();
  expect(container.textContent).toMatch(/couldn’t send a code to that number/);
  expect(container.textContent).not.toMatch(/21211|To' Phone/);
});

it('shows a pending state while the send is in flight and the code field once it succeeds', async () => {
  let release!: (v: OtpResult) => void;
  fixture.otpHeld = new Promise((r) => { release = r; });
  await render();
  await changeInput(input('tel')!, '7025550100');
  await submit();

  const submitButton = container.querySelector('button[type="submit"]') as HTMLButtonElement;
  expect(submitButton.disabled).toBe(true);
  expect(submitButton.textContent).toBe('…');

  await act(async () => release({ error: null }));
  expect(container.querySelector('input[placeholder="Enter code"]')).not.toBeNull();
  expect(container.textContent).toMatch(/We sent a code to your phone/);
});

it('leaves the access-code path unchanged', async () => {
  await render();
  await act(async () => tab('Password').click());
  await changeInput(container.querySelector('input[placeholder="Access code"]') as HTMLInputElement, '0000');
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ip: '203.0.113.7' }) })));
  await submit();
  vi.unstubAllGlobals();

  expect(fixture.rpcCalls).toEqual([{ name: 'validate_data_room_access_code', args: { p_organization_id: 'org-1', p_code: '0000', p_identifier: '203.0.113.7' } }]);
  expect(container.textContent).toMatch(/NON-DISCLOSURE AGREEMENT/);
});
