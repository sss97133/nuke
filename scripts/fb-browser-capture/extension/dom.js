// Isolated-world rendered DOM only. No page-world scripts, hidden stores or API access.
(() => {
  function sourceTarget(value) { try { const u = new URL(value); if (u.protocol !== 'https:' || !['www.facebook.com','facebook.com'].includes(u.hostname) || u.username || u.password || u.port) return null; return u.pathname === '/marketplace/category/vehicles/' ? 'search' : u.pathname === '/saved/' ? 'saved' : null; } catch { return null; } }
  function scoped(value, expected = 'search') { return sourceTarget(value) === expected; }
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
  function itemId(href) {
    try { const u = new URL(href, 'https://www.facebook.com'); return u.protocol === 'https:' && ['www.facebook.com','facebook.com'].includes(u.hostname) && !u.username && !u.password && !u.port ? u.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/)?.[1] ?? null : null; } catch { return null; }
  }
  function imageWitnesses(node) {
    return [...node.querySelectorAll('img')].filter(visible).map(img => ({ url: img.currentSrc || img.src, alt: img.alt || null })).filter(img => { try { const u = new URL(img.url); return u.protocol === 'https:' && (u.hostname.endsWith('.fbcdn.net') || u.hostname === 'fbcdn.net'); } catch { return false; } }).slice(0,4);
  }
  function parseSavedCard({ href, title, productLine, images = [] }, observedAt) {
    const id = itemId(href), parts = productLine?.split('•').map(part => part.trim());
    if (!id || !title?.trim() || /^Saved from\b/i.test(title.trim()) || parts?.[0] !== 'Product' || !parts[1]) return null;
    const askingText = parts[1];
    // Retain the original title and asking excerpt; account names and Saved controls are outside this capture.
    const sellerSeparator = productLine.indexOf('•', productLine.indexOf('•') + 1);
    const productExcerpt = productLine.slice(0, sellerSeparator === -1 ? undefined : sellerSeparator).trim();
    const item = { facebook_id: id, url: `https://www.facebook.com/marketplace/item/${id}/`, title: title.trim(),
      content_text: JSON.stringify({ displayed_text: `${title.trim()}\n${productExcerpt}`, text_scope: 'listing_title_and_asking_excerpt', rendered_images: images }), status: 'unknown',
      agent_context: { agent_id: 'fb-browser-capture', session_type: 'browser_saved_card', source_observed_at: observedAt, asking_texts: [askingText], price_precision: 'unknown', currency: null, source_status_label: null, status_basis: 'saved_card_presence_not_availability', image_witnesses: images } };
    const year = item.title.match(/^(19\d{2}|20\d{2})\s/)?.[1];
    if (year) item.parsed_year = Number(year);
    // The canonical amount is an integer; fractional displays stay in the original witness only.
    if (/^\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.00)?$/.test(askingText)) {
      const price = Number(askingText.slice(1).replaceAll(',', ''));
      if (Number.isSafeInteger(price)) { item.price = price; item.agent_context.price_precision = 'displayed_amount'; }
    }
    return item;
  }
  function savedCards(main, maxNew, seenIds, observedAt) {
    const cards = [], ids = new Set();
    for (const anchor of main.querySelectorAll('a[href*="/marketplace/item/"]')) {
      if (cards.length >= maxNew) break;
      const id = itemId(anchor.href), title = anchor.innerText?.trim();
      if (!id || seenIds.has(id) || ids.has(id) || !visible(anchor) || !title || /^Saved from\b/i.test(title)) continue;
      let owner = null, productLine = null, parent = anchor.parentElement;
      // Observed Saved layout: title+Product metadata share a parent; the next parent adds the image.
      // Bound traversal to one item ID, never read the surrounding feed or unrelated Saved posts.
      for (let depth = 0; parent && parent !== main && depth < 4; depth++, parent = parent.parentElement) {
        // The attribution link itself says "Seller's post"; its containing span supplies "Saved from".
        // It must never become a title when the actual title has scrolled out of view.
        if (/^Saved from\b/i.test((parent.innerText ?? '').trim())) { owner = null; break; }
        const linkedIds = new Set([...parent.querySelectorAll('a[href*="/marketplace/item/"]')].map(link => itemId(link.href)).filter(Boolean));
        if (linkedIds.size !== 1 || !linkedIds.has(id)) break;
        const lines = (parent.innerText ?? '').split('\n').map(line => line.trim()).filter(line => /^Product\s*•/.test(line));
        if (lines.length === 1) { owner = parent; productLine = lines[0]; }
      }
      if (!owner) continue;
      const images = [...owner.querySelectorAll('a[href*="/marketplace/item/"]')].filter(link => itemId(link.href) === id).flatMap(imageWitnesses).slice(0, 4);
      const item = parseSavedCard({ href: anchor.href, title, productLine, images }, observedAt);
      if (item) { ids.add(id); cards.push(item); }
    }
    return cards;
  }
  function scan(maxNew = 200, seenIds = new Set(), target = 'search') {
    if (!scoped(location.href, target)) throw new Error('source_scope_changed');
    const label = target === 'saved' ? 'Preview of a saved item' : 'Collection of Marketplace items';
    const main = document.querySelector(`main[aria-label="${label}"], [role="main"][aria-label="${label}"]`);
    const alerts = [...document.querySelectorAll('[role="alert"], [role="dialog"] h1, [role="dialog"] h2')].filter(visible).map(n => n.innerText).join(' ');
    if (/log in|sign in|checkpoint|captcha|verify (your|you)|temporarily blocked|too many requests|try again later|confirm your identity/i.test(alerts) || [...document.querySelectorAll('input[type="password"]')].some(visible)) throw new Error('source_access_challenge');
    if (!main) throw new Error(target === 'saved' ? 'saved_collection_unavailable' : 'marketplace_collection_unavailable');
    const observedAt = new Date().toISOString(), cards = [], ids = new Set();
    if (target === 'saved') return { cards: savedCards(main, maxNew, seenIds, observedAt), actual_url: location.href, actual_region: 'Saved collection (geographic scope unknown)', observed_at: observedAt, displayed_filters: { collection: 'saved', marketplace_items_only: true }, main };
    for (const anchor of main.querySelectorAll('a[href*="/marketplace/item/"]')) {
      if (cards.length >= maxNew) break;
      if (!visible(anchor)) continue;
      const linkId = anchor.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/)?.[1];
      if (!linkId || seenIds.has(linkId)) continue;
      const images = imageWitnesses(anchor);
      const item = parseCard({ href: anchor.href, text: anchor.innerText, label: anchor.getAttribute('aria-label'), images }, observedAt);
      if (item && !ids.has(item.facebook_id)) { ids.add(item.facebook_id); cards.push(item); }
    }
    const region = [...document.querySelectorAll('[aria-label]')].filter(visible).map(n => n.getAttribute('aria-label')).find(label => /^Location:.*Within\s+\d+\s+mi/i.test(label ?? '')) ?? 'displayed region unavailable';
    const years = [...document.querySelectorAll('input')].filter(n => visible(n) && /^(1960|1990)$/.test(n.value)).map(n => n.value);
    const newest = [...document.querySelectorAll('[role="radio"]')].filter(visible).some(n => /newest/i.test(n.innerText || n.getAttribute('aria-label') || '') && n.getAttribute('aria-checked') === 'true');
    return { cards, actual_url: location.href, actual_region: region, observed_at: observedAt,
      displayed_filters: { year_values: years, newest_first_checked: newest }, main };
  }
  globalThis.NukeMarketplaceDOM = { parseCard, parseSavedCard, scan, visible, scoped, sourceTarget };
})();
