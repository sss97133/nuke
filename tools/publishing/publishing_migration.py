#!/usr/bin/env python3
"""
Create publishing tables in Supabase and set up RLS policies.

Tables created:
  - publishing_contacts: 17K professionals from email archives
  - publishing_relationships: 54K relationship edges
  - publishing_communications: aggregated communication stats per contact

Each table is owner-scoped via owner_id + Row Level Security.
Jenny and Philippe are the two operators whose archives feed this system.
"""

import os
import psycopg2

DB_URL = os.environ.get(
    "SUPABASE_DB_URL",
    "postgresql://postgres.PROJECT_REF:PASSWORD"
    "@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
)

# Deterministic UUIDs for operators (will be linked to auth accounts later)
JENNY_ID = "00000000-0000-4000-a000-000000000001"
PHILIPPE_ID = "00000000-0000-4000-a000-000000000002"

MIGRATION_SQL = """
-- ============================================================
-- Publishing Intelligence Tables
-- Owner-scoped with Row Level Security
-- ============================================================

-- 1. Publishing Contacts
-- The 17K professionals extracted from email archives
CREATE TABLE IF NOT EXISTS publishing_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,

    -- Identity
    name TEXT NOT NULL,
    email TEXT,
    domain TEXT,

    -- Professional
    professional_title TEXT,
    org_name TEXT,
    org_role TEXT,
    publications_worked TEXT,
    credit_count INTEGER DEFAULT 0,
    credit_roles TEXT,
    primary_publication TEXT,

    -- Activity
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    active_months INTEGER DEFAULT 0,
    years_active INTEGER DEFAULT 0,
    is_cross_publication BOOLEAN DEFAULT FALSE,

    -- Behavioral (operator's private assessment)
    reliability_score REAL,
    reliability_factors JSONB,
    ghost_status TEXT,
    ghost_risk REAL,
    responsiveness_hours REAL,
    relationship_phase TEXT,
    relationship_warmth REAL,
    trajectory TEXT,

    -- Role intelligence
    role_spectrum JSONB,

    -- Cross-channel
    imessage_contact TEXT,
    imessage_volume INTEGER DEFAULT 0,
    cross_channel_score REAL,

    -- Communication summary
    total_sent INTEGER DEFAULT 0,
    total_received INTEGER DEFAULT 0,
    total_cc INTEGER DEFAULT 0,
    preferred_language TEXT,

    -- Classification
    is_noise BOOLEAN DEFAULT FALSE,
    privacy_tier TEXT DEFAULT 'private' CHECK (privacy_tier IN ('private', 'published', 'mutual')),
    source TEXT DEFAULT 'email_intelligence',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Publishing Relationships
-- Directed edges: who communicated with whom, from the operator's perspective
CREATE TABLE IF NOT EXISTS publishing_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,

    source_email TEXT NOT NULL,
    target_email TEXT NOT NULL,
    source_name TEXT,
    target_name TEXT,

    weight INTEGER DEFAULT 1,
    edge_type TEXT,
    first_date TIMESTAMPTZ,
    last_date TIMESTAMPTZ,
    is_reciprocal BOOLEAN DEFAULT FALSE,
    avg_interval_days REAL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Publishing Communications
-- Per-contact aggregated stats (no raw messages)
CREATE TABLE IF NOT EXISTS publishing_communications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    contact_id UUID REFERENCES publishing_contacts(id),
    email TEXT,

    total_sent INTEGER DEFAULT 0,
    total_received INTEGER DEFAULT 0,
    total_cc INTEGER DEFAULT 0,
    unique_correspondents INTEGER DEFAULT 0,

    avg_response_time_hours REAL,
    median_response_time_hours REAL,
    initiator_ratio REAL,
    cc_ratio REAL,
    activity_density REAL,
    activity_pattern TEXT,

    peak_activity_hour INTEGER,
    peak_activity_day INTEGER,
    preferred_language TEXT,
    attachment_rate REAL,
    financial_rate REAL,

    source_accounts TEXT,
    channel TEXT DEFAULT 'email',

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pc_owner ON publishing_contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_pc_email ON publishing_contacts(email);
CREATE INDEX IF NOT EXISTS idx_pc_name ON publishing_contacts(name);
CREATE INDEX IF NOT EXISTS idx_pc_domain ON publishing_contacts(domain);
CREATE INDEX IF NOT EXISTS idx_pc_ghost ON publishing_contacts(owner_id, ghost_status);
CREATE INDEX IF NOT EXISTS idx_pc_reliability ON publishing_contacts(owner_id, reliability_score DESC);

CREATE INDEX IF NOT EXISTS idx_pr_owner ON publishing_relationships(owner_id);
CREATE INDEX IF NOT EXISTS idx_pr_source ON publishing_relationships(source_email);
CREATE INDEX IF NOT EXISTS idx_pr_target ON publishing_relationships(target_email);

CREATE INDEX IF NOT EXISTS idx_pcomm_owner ON publishing_communications(owner_id);
CREATE INDEX IF NOT EXISTS idx_pcomm_contact ON publishing_communications(contact_id);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE publishing_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE publishing_communications ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.
-- These policies control authenticated user access.
DO $$ BEGIN
    -- Contacts: owner sees own rows
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pc_owner_select') THEN
        CREATE POLICY pc_owner_select ON publishing_contacts
            FOR SELECT USING (auth.uid() = owner_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pc_owner_insert') THEN
        CREATE POLICY pc_owner_insert ON publishing_contacts
            FOR INSERT WITH CHECK (auth.uid() = owner_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pc_owner_update') THEN
        CREATE POLICY pc_owner_update ON publishing_contacts
            FOR UPDATE USING (auth.uid() = owner_id);
    END IF;

    -- Relationships: owner sees own rows
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pr_owner_select') THEN
        CREATE POLICY pr_owner_select ON publishing_relationships
            FOR SELECT USING (auth.uid() = owner_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pr_owner_insert') THEN
        CREATE POLICY pr_owner_insert ON publishing_relationships
            FOR INSERT WITH CHECK (auth.uid() = owner_id);
    END IF;

    -- Communications: owner sees own rows
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pcomm_owner_select') THEN
        CREATE POLICY pcomm_owner_select ON publishing_communications
            FOR SELECT USING (auth.uid() = owner_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'pcomm_owner_insert') THEN
        CREATE POLICY pcomm_owner_insert ON publishing_communications
            FOR INSERT WITH CHECK (auth.uid() = owner_id);
    END IF;
END $$;

-- Also add owner_id + RLS to existing publishing tables that lack it
DO $$ BEGIN
    -- Add owner_id to nuke_production_credits if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'nuke_production_credits' AND column_name = 'owner_id'
    ) THEN
        ALTER TABLE nuke_production_credits ADD COLUMN owner_id UUID;
    END IF;

    -- Add owner_id to production_files if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'production_files' AND column_name = 'owner_id'
    ) THEN
        ALTER TABLE production_files ADD COLUMN owner_id UUID;
    END IF;
END $$;
"""


def main():
    print("Connecting to Supabase Postgres via pooler...")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print("Running migration...")
    cur.execute(MIGRATION_SQL)
    print("Migration complete.")

    # Verify tables exist
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN (
            'publishing_contacts',
            'publishing_relationships',
            'publishing_communications'
        )
        ORDER BY table_name;
    """)
    tables = cur.fetchall()
    print(f"\nVerified {len(tables)} tables:")
    for t in tables:
        print(f"  {t[0]}")

    # Check RLS is enabled
    cur.execute("""
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename IN (
            'publishing_contacts',
            'publishing_relationships',
            'publishing_communications'
        );
    """)
    for name, rls in cur.fetchall():
        print(f"  {name}: RLS={'enabled' if rls else 'disabled'}")

    cur.close()
    conn.close()
    print("\nDone. Tables ready for ingestion.")


if __name__ == "__main__":
    main()
