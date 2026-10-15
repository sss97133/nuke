/**
 * Pure readers for a rendered Marketplace listing page (innerText + image metrics). The layout assumptions here are
 * unverified against a live logged-in page until the first detail probe runs; the probe stores the raw text so these
 * can be corrected against retained pages. Anything not found stays null, never guessed.
 */
const UNAVAILABLE = /(this listing (isn.t|is not|is no longer) available|listing (was|has been) removed|this content isn.t available|no longer available|this page isn.t available)/i;
const SECTION_END = /^(seller information|seller details|location|today.s picks|related listings|more from|message seller|send seller a message|send message|is this still available)/i;

export function readListingPage({ text = '', title = null, images = [] }, observedAt) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const unavailable = UNAVAILABLE.test(text.slice(0, 4000)) && !title;
  const label = lines.slice(0, 40).find(l => /^(sold|pending)$/i.test(l))?.toLowerCase() ?? null;
  const at = lines.findIndex(l => /^(seller.s description|description)$/i.test(l));
  let description = null;
  if (at >= 0) {
    const body = [];
    for (const l of lines.slice(at + 1)) { if (SECTION_END.test(l)) break; if (/^see (more|less)$/i.test(l)) continue; body.push(l); }
    description = body.join('\n') || null;
  }
  const sellerAt = lines.findIndex(l => /^seller (information|details)$/i.test(l));
  const sellerBlock = sellerAt >= 0 ? lines.slice(sellerAt + 1, sellerAt + 8) : [];
  const sellerName = sellerBlock.find(l => !/^(seller|joined|rating|ratings|view|message|·|\d)/i.test(l)) ?? null;
  // Only a page that says so counts as a business; absence of the word is "unknown", not "private".
  const sellerType = sellerBlock.some(l => /\b(business|dealership|dealer)\b/i.test(l)) ? 'business' : null;
  const listed = lines.find(l => /^listed\s+.+\s+in\s+/i.test(l)) ?? null;
  const price = lines.slice(0, 15).map(l => l.match(/^\$\s?([\d,]+)$/)?.[1]).find(Boolean);
  const sizes = images.filter(i => i.url && /fbcdn\.net/.test(i.url)).map(i => ({ url: i.url, width: i.width ?? null, height: i.height ?? null }));
  const unique = [...new Map(sizes.map(i => [i.url, i])).values()];
  return { unavailable, status_label: label, title, price: price ? Number(price.replaceAll(',', '')) : null, listed_label: listed, description,
    description_complete: description !== null && !lines.some(l => /^see more$/i.test(l)), seller_name: sellerName, seller_type: sellerType, seller_type_basis: sellerType ? 'page_text' : 'not_shown',
    images: unique, observed_at: observedAt };
}

/** One packet card for a revisited listing: either the removal evidence or the full detail. */
export function revisitCard(id, page, ctx) {
  const base = { facebook_id: id, url: `https://www.facebook.com/marketplace/item/${id}/`, title: page.title ?? ctx.title ?? `listing ${id}`,
    content_text: JSON.stringify({ displayed_text: ctx.text.slice(0, 20000), listed_label: page.listed_label, seller_type_basis: page.seller_type_basis }),
    status: 'active', agent_context: { agent_id: 'fb-playwright-capture', session_type: 'browser_listing_page', source_observed_at: page.observed_at } };
  if (page.unavailable) {
    return { ...base, removal: { observed_at: page.observed_at, reason: 'revisit_unavailable', basis: 'listing_page_unavailable', evidence: ctx.text.slice(0, 200) } };
  }
  if (page.status_label === 'sold') {
    return { ...base, status: 'sold', removal: { observed_at: page.observed_at, reason: 'displayed_sold', basis: 'displayed_seller_label', evidence: 'Sold' } };
  }
  if (page.status_label === 'pending') base.status = 'pending';
  if (page.price !== null) base.price = page.price;
  if (page.description) base.description = page.description;
  if (page.seller_name) base.seller_name = page.seller_name;
  if (page.images.length) { base.all_images = page.images.map(i => i.url); base.image_url = base.all_images[0]; base.agent_context.image_sizes = page.images.map(i => [i.width, i.height]); }
  base.agent_context.description_complete = page.description_complete;
  base.agent_context.seller_type = page.seller_type; base.agent_context.seller_type_basis = page.seller_type_basis;
  return base;
}
