/** Display only: keep the supplier/handle in imported eBay labels, without the
 * appended person/signature notes. The retained receipt text is unchanged.
 * This handles that delimited supplier format, not arbitrary prose or PII. */
export function receiptSupplierLabel(value: string | null | undefined): string | null {
  const label = value?.trim();
  if (!label) return null;
  if (!/^ebay\s+seller\s+/i.test(label)) return label;

  const supplier = label.split(/;\s*(?:message\s+)?signed\b/i, 1)[0].trim();
  return supplier.replace(/\s*\(([^()]*)\)/g, (annotation, alias: string) => {
    // Compact account handles and explicit automotive business aliases remain.
    // Other multiword annotations are not needed to identify the seller account.
    const handle = /^[\w.-]+$/.test(alias.trim());
    const business = /\b(?:auto|automotive|parts|supply|supplies|performance|motors|restorations?|industries|llc|inc|ltd)\b/i.test(alias);
    return handle || business ? annotation : '';
  }).trim();
}
