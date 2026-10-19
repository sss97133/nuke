/**
 * ownerMoney — the owner's private money on a vehicle row is owner-only, the same rule the database reader
 * vehicle_owner_books enforces (#1164) and the #1175 column revoke enforces for the browser's publishable key.
 *
 * The public API (api-v1-vehicles, api-v1-vin-lookup) runs with the project secret key, which bypasses row
 * security, so it has to apply the rule itself: a public vehicle is visible to any API key, but its
 * purchase_price, purchase_date and purchase_location are not. The owner (the key's user owns the row) and the
 * service role keep them; every other caller gets null in their place, so the field shape is unchanged.
 *
 * owner_id is the only owner column these endpoints select; the database reader also admits user_id,
 * created_by_user_id, uploaded_by and vehicle_user_has_access, so this is the stricter of the two — it never
 * shows the money to a caller the reader would refuse.
 */
const OWNER_MONEY_KEYS = ["purchase_price", "purchase_date", "purchase_location"] as const;

export function maskOwnerMoney<T extends Record<string, unknown>>(
  row: T,
  callerUserId: string | null,
  isServiceRole: boolean | undefined,
): T {
  if (!row) return row;
  const owns = isServiceRole === true
    || (callerUserId != null && row.owner_id === callerUserId);
  if (owns) return row;
  const masked: Record<string, unknown> = { ...row };
  for (const key of OWNER_MONEY_KEYS) {
    if (key in masked) masked[key] = null;
  }
  return masked as T;
}
