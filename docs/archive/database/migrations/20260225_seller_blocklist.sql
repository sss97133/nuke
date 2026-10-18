-- Seller blocklist: tracks known bad actors (scammers, disguised dealers)
-- Matched against scraped listing content during CL queue processing

CREATE TABLE seller_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_type text NOT NULL CHECK (fingerprint_type IN ('domain', 'phone', 'email', 'cl_user', 'name')),
  fingerprint_value text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('scammer', 'dealer', 'fraudulent', 'spam', 'overpriced')),
  notes text,
  active boolean NOT NULL DEFAULT true,
  first_seen_url text,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  blocked_by text NOT NULL DEFAULT 'system',
  UNIQUE (fingerprint_type, fingerprint_value)
);

CREATE INDEX idx_seller_blocklist_value ON seller_blocklist (fingerprint_value) WHERE active = true;

-- Seed with autosource.biz
INSERT INTO seller_blocklist (fingerprint_type, fingerprint_value, reason, notes, first_seen_url, blocked_by)
VALUES (
  'domain',
  'autosource.biz',
  'dealer',
  'Dealer posting in cto (by owner) category on CL to evade filters. Miami-based. Overpriced inventory.',
  'https://miami.craigslist.org/mdc/ctd/d/miami-1967-corvette-insurance-theft/7913195805.html',
  'manual'
);
