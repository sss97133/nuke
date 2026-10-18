/**
 * Visitor-facing text for Supabase auth failures. Raw provider/database messages are never shown;
 * every message offers email as the way forward.
 */

/** True when the SMS provider itself refused to send (e.g. Twilio 20003), not when the number is bad. */
export function isSmsProviderUnavailable(raw: string | undefined | null): boolean {
  const lower = (raw ?? '').toLowerCase();
  if (!lower) return false;
  // Twilio 21211/21614 and "Invalid 'To' Phone Number" describe the visitor's number, not an outage.
  if (lower.includes('phone number') || lower.includes('21211') || lower.includes('21614')) return false;
  return (
    lower.includes('twilio') ||
    lower.includes('20003') ||
    lower.includes('sms provider') ||
    lower.includes('unsupported phone provider') ||
    (lower.includes('otp') && (lower.includes('provider') || lower.includes('authenticate')))
  );
}

export function friendlyAuthError(raw: string | undefined | null): string {
  if (!raw) return 'Something went wrong. Please try again or use your email instead.';
  const lower = raw.toLowerCase();
  if (isSmsProviderUnavailable(raw)) {
    return 'We can’t send text codes right now. Please use your email instead to continue.';
  }
  if (lower.includes('database') || lower.includes('saving new user') || lower.includes('duplicate') || lower.includes('constraint') || lower.includes('row-level')) {
    return 'Something went wrong on our side. Please try again or use your email instead to continue.';
  }
  if (lower.includes('phone') && (lower.includes('invalid') || lower.includes('not supported') || lower.includes('not a mobile'))) {
    return 'We couldn’t send a code to that number. Please try your email instead.';
  }
  if ((lower.includes('invalid') || lower.includes('expired')) && (lower.includes('code') || lower.includes('token') || lower.includes('otp'))) {
    return 'That code isn’t valid. Please try again or request a new code.';
  }
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('security purposes')) {
    return 'Too many attempts. Please wait a minute and try again, or use your email instead.';
  }
  return 'Something went wrong. Please try again or use your email instead.';
}

/** E.164 for the gate's inputs: 10 digits are US numbers; formatting characters are dropped. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}
