// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingSlideshow } from './OnboardingSlideshow';

let root: Root, host: HTMLDivElement, onClose: ReturnType<typeof vi.fn>;
function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  onClose = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const mount = async (signedIn: boolean) => act(async () => root.render(
  <MemoryRouter initialEntries={['/']}>
    <Routes><Route path="*" element={<><OnboardingSlideshow isOpen onClose={onClose} signedIn={signedIn} /><Where /></>} /></Routes>
  </MemoryRouter>,
));
const button = (text: string) => [...host.querySelectorAll('button')].find((el) => el.textContent === text);
const labels = () => [...host.querySelectorAll('button')].map((el) => el.textContent);
const where = () => host.querySelector('[data-testid="where"]')?.textContent;
const toLastSlide = async () => { for (let i = 0; i < 2; i++) await act(async () => button('NEXT')!.click()); };

describe('a signed-in first-timer', () => {
  it('is sent to add a vehicle, never back to signup', async () => {
    await mount(true);
    expect(labels()).toContain('SKIP TO ADD VEHICLE');
    expect(labels()).not.toContain('SKIP TO SIGN UP');
    await toLastSlide();
    expect(labels()).toContain('ADD YOUR FIRST VEHICLE');
    expect(labels()).toContain('BROWSE THE MARKET');
    expect(labels()).not.toContain('CREATE ACCOUNT');
    expect(labels()).not.toContain('SIGN IN');
    await act(async () => button('ADD YOUR FIRST VEHICLE')!.click());
    expect(where()).toBe('/vehicle/add');
    expect(onClose).toHaveBeenCalled();
  });
  it('can close into the market it is covering', async () => {
    await mount(true);
    await toLastSlide();
    await act(async () => button('BROWSE THE MARKET')!.click());
    expect(where()).toBe('/');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a signed-out visitor', () => {
  it('keeps the account calls to action', async () => {
    await mount(false);
    expect(labels()).toContain('SKIP TO SIGN UP');
    await toLastSlide();
    expect(labels()).toContain('CREATE ACCOUNT');
    expect(labels()).toContain('SIGN IN');
    await act(async () => button('CREATE ACCOUNT')!.click());
    expect(where()).toBe('/signup');
  });
});
