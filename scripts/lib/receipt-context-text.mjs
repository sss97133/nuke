// Pure context formatting shared by Node preparation and read-only Deno validation.
export function receiptContextVendor(vendor) {
  // Marketplace handles are useful source identity; the appended seller's
  // personal name is not needed to reconcile a part or its financial record.
  if (typeof vendor !== 'string') return vendor;
  const withoutParentheticalName = vendor.replace(/(\beBay seller\s+[^;(\n]+?)\s*\([^)]*\)/gi, '$1');
  return /^eBay seller\s/i.test(withoutParentheticalName)
    ? withoutParentheticalName.replace(/;\s*message signed\s+[^\n]+$/i, '')
    : withoutParentheticalName;
}
export function contextWithoutPersonalFields(context) {
  // Applies the same exclusion to retained prepared briefings without changing
  // the original receipt artifact or dropping amounts/operations/source IDs.
  return context
    .replace(/("vendor"\s*:\s*)("(?:\\.|[^"\\])*")/g,
      (_, before, value) => before + JSON.stringify(receiptContextVendor(JSON.parse(value))))
    .replace(/(; vendor )(eBay seller[^\n]+?)(; receipt)/gi,
      (_, before, vendor, after) => before + receiptContextVendor(vendor) + after);
}
