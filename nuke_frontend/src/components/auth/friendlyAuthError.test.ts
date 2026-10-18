import { describe, expect, it } from 'vitest';
import { friendlyAuthError, isSmsProviderUnavailable, normalizePhone } from './friendlyAuthError';

const TWILIO_20003 = 'Error sending confirmation OTP to provider: Authenticate More information: https://www.twilio.com/docs/errors/20003';
const TWILIO_BAD_TO = "Error sending confirmation OTP to provider: Invalid 'To' Phone Number: +1555 More information: https://www.twilio.com/docs/errors/21211";

describe('friendlyAuthError', () => {
  it('treats Twilio 20003 as a provider outage and hides the raw text', () => {
    expect(isSmsProviderUnavailable(TWILIO_20003)).toBe(true);
    const text = friendlyAuthError(TWILIO_20003);
    expect(text).toMatch(/can’t send text codes/);
    expect(text).not.toMatch(/twilio|20003|authenticate/i);
  });

  it('treats an invalid destination number as the visitor’s number, not an outage', () => {
    expect(isSmsProviderUnavailable(TWILIO_BAD_TO)).toBe(false);
    expect(friendlyAuthError(TWILIO_BAD_TO)).toMatch(/couldn’t send a code to that number/);
  });

  it('keeps the existing database and code messages', () => {
    expect(friendlyAuthError('Database error saving new user')).toMatch(/on our side/);
    expect(friendlyAuthError('Token has expired or is invalid')).toMatch(/code isn’t valid/);
    expect(friendlyAuthError(undefined)).toMatch(/use your email/);
  });

  it('never returns the raw message for unknown failures', () => {
    expect(friendlyAuthError('PRIVATE_FAILURE xyz')).not.toContain('PRIVATE_FAILURE');
  });
});

describe('normalizePhone', () => {
  it('produces E.164 from formatted input', () => {
    expect(normalizePhone('(702) 555-0100')).toBe('+17025550100');
    expect(normalizePhone('+1 702 555 0100')).toBe('+17025550100');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
  });
});
