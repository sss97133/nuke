import { describe, it, expect } from 'vitest';
import { isVerifiedOwnerOf } from './ownerStatus';

const flagged = { ownership_verified: true, user_id: 'u-owner', owner_id: null };
const approved = { user_id: 'u-claim', status: 'approved', title_document_url: 'https://x/title.pdf', drivers_license_url: 'https://x/id.pdf' };

describe('isVerifiedOwnerOf', () => {
  it('a vehicle-level flag never makes a reader the owner', () => {
    expect(isVerifiedOwnerOf(flagged, null, null)).toBe(false);
    expect(isVerifiedOwnerOf(flagged, undefined, null)).toBe(false);
    expect(isVerifiedOwnerOf(flagged, 'u-stranger', null)).toBe(false);
  });
  it('the flag confirms the person the record names', () => {
    expect(isVerifiedOwnerOf(flagged, 'u-owner', null)).toBe(true);
    expect(isVerifiedOwnerOf({ ownership_verified: true, user_id: null, owner_id: 'u-owner' }, 'u-owner', null)).toBe(true);
    expect(isVerifiedOwnerOf({ ownership_verified: false, user_id: 'u-owner', owner_id: null }, 'u-owner', null)).toBe(false);
  });
  it('an approved verification with both documents makes its claimant the owner', () => {
    expect(isVerifiedOwnerOf({ ownership_verified: false }, 'u-claim', approved)).toBe(true);
    expect(isVerifiedOwnerOf({ ownership_verified: false }, 'u-claim', { ...approved, status: 'pending' })).toBe(false);
    expect(isVerifiedOwnerOf({ ownership_verified: false }, 'u-claim', { ...approved, title_document_url: 'pending' })).toBe(false);
    expect(isVerifiedOwnerOf({ ownership_verified: false }, 'u-claim', { ...approved, drivers_license_url: null })).toBe(false);
    expect(isVerifiedOwnerOf({ ownership_verified: false }, 'u-other', approved)).toBe(false);
  });
});
