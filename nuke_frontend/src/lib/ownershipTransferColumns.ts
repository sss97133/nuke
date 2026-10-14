// The ownership_transfers columns anon and authenticated may read. The seven sensitive columns — the two party
// access tokens, inbox_email, and the parties' emails and phones — are not granted to those roles
// (migration 20261014190000_transfer_party_credentials_owner_only); selecting one, or '*', fails with a permission
// error. The /t/ party page learns its role through the transfer_party_role RPC, and the admin dashboard reads the
// link fields through the transfer_admin_links RPC. Keep this a single template literal so supabase-js types the
// result (a joined string yields GenericStringError).
export const OWNERSHIP_TRANSFER_PUBLIC_COLUMNS =
  'id, vehicle_id, from_user_id, to_user_id, from_identity_id, to_identity_id, trigger_type, trigger_id, ' +
  'trigger_table, agreed_price, currency, status, sale_date, completed_at, cancelled_at, stalled_at, ' +
  'last_milestone_at, public_visibility, created_at, updated_at';
