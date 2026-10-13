// Isolated-world rendered DOM only. No page-world scripts, hidden stores or API access.
(() => {
  function scoped(value) { try { const u = new URL(value); return u.protocol === 'https:' && ['www.facebook.com','facebook.com'].includes(u.hostname) && u.pathname === '/marketplace/category/vehicles/' && !u.username && !u.password; } catch { return false; } }
  function visible(node) {
    const r = node.getBoundingClientRect(), style = getComputedStyle(node);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
  }
  function parseCard({ href, text, label, images = [] }, observedAt) {
    let id; try { const u = new URL(href, 'https://www.facebook.com'); if (!['www.facebook.com','facebook.com'].includes(u.hostname)) return null; id = u.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/)?.[1]; } catch { return null; }
    if (!id || !text?.trim()) return null;
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    const asking = lines.filter(line => /^[€£$]\s*[\d,.]|^free$|contact seller|negotiable/i.test(line));
    const labelPrice = (label ?? '').match(/,\s*(\$[\d,]+)(?=,\s)/);
    const priceText = asking.length === 1 ? asking[0] : null;
    const price = priceText && /^\$\d[\d,]*$/.test(priceText) ? Number(priceText.slice(1).replaceAll(',','')) : null;
    const cleanLabel = (label ?? '').replace(/,\s*listing\s+\d+\s*$/i, '');
    const title = labelPrice ? cleanLabel.slice(0, labelPrice.index).trim() : lines.find(line => !asking.includes(line) && !/^(just listed|sponsored|pending|sold|reduced|new listing)$/i.test(line)) ?? '';
    if (!title) return null;
    const location = labelPrice ? cleanLabel.slice(labelPrice.index + labelPrice[0].length).replace(/^,\s*/, '').trim() : null;
    const year = title.match(/^(19\d{2}|20\d{2})\s/)?.[1];
    const statusLabel = lines.find(line => /^(sold|pending)$/i.test(line)) ?? null;
    const item = { facebook_id: id, url: `https://www.facebook.com/marketplace/item/${id}/`, title,
      content_text: JSON.stringify({ displayed_text: text, accessible_label: label ?? null, rendered_images: images }),
      status: statusLabel ? statusLabel.toLowerCase() : 'active', agent_context: { agent_id: 'fb-browser-capture', session_type: 'browser_search_card', source_observed_at: observedAt, asking_texts: asking, price_precision: price === null ? 'unknown' : 'displayed_amount', currency: null, source_status_label: statusLabel, status_basis: statusLabel ? 'displayed_seller_label' : 'rendered_card_presence', image_witnesses: images } };
    if (price !== null && Number.isSafeInteger(price)) item.price = price;
    if (location) item.location = location;
    if (year) item.parsed_year = Number(year);
    return item;
  }
  function scan(maxNew = 200, seenIds = new Set()) {
    if (!scoped(location.href)) throw new Error('source_scope_changed');
    const main = document.querySelector('main[aria-label="Collection of Marketplace items"], [role="main"][aria-label="Collection of Marketplace items"]');
    const alerts = [...document.querySelectorAll('[role="alert"], [role="dialog"] h1, [role="dialog"] h2')].filter(visible).map(n => n.innerText).join(' ');
    if (/log in|sign in|checkpoint|captcha|verify (your|you)|temporarily blocked|too many requests|try again later|confirm your identity/i.test(alerts) || [...document.querySelectorAll('input[type="password"]')].some(visible)) throw new Error('source_access_challenge');
    if (!main) throw new Error('marketplace_collection_unavailable');
    const observedAt = new Date().toISOString(), cards = [], ids = new Set();
    for (const anchor of main.querySelectorAll('a[href*="/marketplace/item/"]')) {
      if (cards.length >= maxNew) break;
      if (!visible(anchor)) continue;
      const linkId = anchor.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/)?.[1];
      if (!linkId || seenIds.has(linkId)) continue;
      const images = [...anchor.querySelectorAll('img')].filter(visible).map(img => ({ url: img.currentSrc || img.src, alt: img.alt || null })).filter(img => { try { const u = new URL(img.url); return u.protocol === 'https:' && (u.hostname.endsWith('.fbcdn.net') || u.hostname === 'fbcdn.net'); } catch { return false; } }).slice(0,4);
      const item = parseCard({ href: anchor.href, text: anchor.innerText, label: anchor.getAttribute('aria-label'), images }, observedAt);
      if (item && !ids.has(item.facebook_id)) { ids.add(item.facebook_id); cards.push(item); }
    }
    const region = [...document.querySelectorAll('[aria-label]')].filter(visible).map(n => n.getAttribute('aria-label')).find(label => /^Location:.*Within\s+\d+\s+mi/i.test(label ?? '')) ?? 'displayed region unavailable';
    const years = [...document.querySelectorAll('input')].filter(n => visible(n) && /^(1960|1990)$/.test(n.value)).map(n => n.value);
    const newest = [...document.querySelectorAll('[role="radio"]')].filter(visible).some(n => /newest/i.test(n.innerText || n.getAttribute('aria-label') || '') && n.getAttribute('aria-checked') === 'true');
    return { cards, actual_url: location.href, actual_region: region, observed_at: observedAt,
      displayed_filters: { year_values: years, newest_first_checked: newest }, main };
  }
  globalThis.NukeMarketplaceDOM = { parseCard, scan, visible, scoped };
})();
