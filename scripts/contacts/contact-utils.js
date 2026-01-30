/**
 * Contact Discovery Utilities
 * Shared functions for contact extraction scripts
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Save a contact lead to discovery_leads
 */
export async function saveContactLead({
  name,
  email,
  phone,
  role,
  region,
  organization,
  sourceUrl,
  extraData = {}
}) {
  const leadName = [organization, region, role].filter(Boolean).join(' ');

  const payload = {
    lead_type: 'person',
    lead_name: leadName || name || 'Unknown Contact',
    lead_url: email ? `mailto:${email}` : null,
    lead_description: `${organization || 'Classic Car'} - ${region || 'Unknown Region'} ${role || 'Member'}. ${email ? `Email: ${email}` : ''}${phone ? ` Phone: ${phone}` : ''}`.trim(),
    discovered_from_type: 'manual',
    discovered_from_url: sourceUrl,
    discovery_method: 'web_scrape',
    confidence_score: email ? 0.95 : 0.7,
    status: 'pending',
    raw_data: {
      name,
      email,
      phone,
      role,
      region,
      organization,
      source: sourceUrl,
      ...extraData
    }
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/discovery_leads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });

  return res.ok;
}

/**
 * Batch save contacts
 */
export async function saveContactLeads(contacts, sourceUrl, organization) {
  let saved = 0;
  let errors = 0;

  for (const contact of contacts) {
    try {
      const ok = await saveContactLead({
        ...contact,
        sourceUrl,
        organization
      });
      if (ok) saved++;
      else errors++;
    } catch (e) {
      errors++;
    }
    // Small delay between saves
    await new Promise(r => setTimeout(r, 100));
  }

  return { saved, errors };
}

/**
 * Extract emails from text
 */
export function extractEmails(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(emailRegex) || [])];
}

/**
 * Extract phone numbers from text
 */
export function extractPhones(text) {
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
  return [...new Set(text.match(phoneRegex) || [])];
}

/**
 * Clean and normalize name
 */
export function cleanName(name) {
  if (!name) return null;
  return name
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.-]/g, '')
    .trim();
}

/**
 * Rate-limited page fetcher
 */
export async function fetchWithDelay(page, url, delay = 1500) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(delay);
  return page;
}

/**
 * Log progress
 */
export function logProgress(source, current, total, saved) {
  const pct = ((current / total) * 100).toFixed(1);
  console.log(`[${source}] ${current}/${total} (${pct}%) - ${saved} saved`);
}

export default {
  saveContactLead,
  saveContactLeads,
  extractEmails,
  extractPhones,
  cleanName,
  fetchWithDelay,
  logProgress
};
