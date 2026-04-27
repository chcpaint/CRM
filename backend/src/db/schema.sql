-- CRM Database Schema (PostgreSQL / Supabase)
-- CHC Paint & Auto Body Supplies

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rep' CHECK(role IN ('rep', 'manager', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  shop_name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  area TEXT,
  province TEXT DEFAULT 'ON',
  contact_names TEXT,
  phone TEXT,
  email TEXT,
  account_type TEXT DEFAULT 'collision',
  assigned_rep_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'prospect' CHECK(status IN ('prospect', 'active', 'cold', 'dnc', 'churned', 'on_hold')),
  suppliers TEXT,
  paint_line TEXT,
  allied_products TEXT,
  sundries TEXT,
  has_contract BOOLEAN DEFAULT false,
  mpo TEXT,
  num_techs INTEGER,
  sq_footage TEXT,
  annual_revenue REAL,
  former_sherwin_client BOOLEAN DEFAULT false,
  follow_up_date TEXT,
  last_contacted_at TIMESTAMPTZ,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  is_voice_transcribed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  rep_id INTEGER NOT NULL REFERENCES users(id),
  activity_type TEXT NOT NULL,
  description TEXT,
  scheduled_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Widen status constraint to include on_hold
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
DO $$ BEGIN
  ALTER TABLE accounts ADD CONSTRAINT accounts_status_check
    CHECK(status IN ('prospect', 'active', 'cold', 'dnc', 'churned', 'on_hold'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Widen activity_type constraint to support new tags
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_activity_type_check;
DO $$ BEGIN
  ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
    CHECK(activity_type IN ('call','email','text','meeting','visit','sales_call','drop_in','contract_presentation','proposal','product_demo','vendor_partner_visit','other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sales_data (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  rep_id INTEGER REFERENCES users(id),
  sale_amount REAL NOT NULL,
  sale_date TEXT NOT NULL,
  month TEXT NOT NULL,
  memo TEXT,
  customer_name TEXT,
  imported_from_accountedge BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'import', 'login', 'logout')),
  changes JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duplicate_flags (
  id SERIAL PRIMARY KEY,
  account_1_id INTEGER NOT NULL REFERENCES accounts(id),
  account_2_id INTEGER NOT NULL REFERENCES accounts(id),
  similarity_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'merged', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_shop_name ON accounts(shop_name);
CREATE INDEX IF NOT EXISTS idx_accounts_city ON accounts(city);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_assigned_rep ON accounts(assigned_rep_id);
CREATE INDEX IF NOT EXISTS idx_accounts_last_contacted ON accounts(last_contacted_at);
CREATE INDEX IF NOT EXISTS idx_notes_account ON notes(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_account ON sales_data(account_id);
CREATE INDEX IF NOT EXISTS idx_sales_month ON sales_data(month);
CREATE INDEX IF NOT EXISTS idx_sales_rep ON sales_data(rep_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);

-- Notification preferences (add to users table)
-- Line-item detail columns for sales_data (for drill-down)
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN item_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN quantity INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN cogs REAL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN profit REAL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN category TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN product_line TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_data ADD COLUMN salesperson TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Notification preferences (add to users table)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN phone TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN notification_email TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN sms_enabled BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN email_enabled BOOLEAN DEFAULT true;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN daily_digest_time TEXT DEFAULT '07:30';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Google Drive auto-import log
CREATE TABLE IF NOT EXISTS gdrive_import_log (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success', 'error', 'running')),
  files_processed INTEGER DEFAULT 0,
  records_imported INTEGER DEFAULT 0,
  unmatched_count INTEGER DEFAULT 0,
  details JSONB DEFAULT '[]',
  error_message TEXT,
  triggered_by TEXT DEFAULT 'cron',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdrive_import_log_created ON gdrive_import_log(created_at DESC);

-- Account category: 'lead' for prospects, 'customer' for active buying customers
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN account_category TEXT DEFAULT 'lead' CHECK(account_category IN ('lead', 'customer'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN branch TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN postal_code TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN phone2 TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN phone_numbers TEXT DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN email_addresses TEXT DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN accountedge_card_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Shop detail fields
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN num_painters INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN num_body_men INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN num_paint_booths INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN cup_brand TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN paper_brand TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN filler_brand TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN contract_status TEXT DEFAULT 'none';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN deal_details TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN banner TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN business_types JSONB DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN business_type_notes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN contract_file_path TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN contract_expiration_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN secondary_rep_id INTEGER REFERENCES users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- PCR-managed flag: true when account was created/promoted by PCR sync (not manually)
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN pcr_managed BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
-- Source PCR shop name (for linking back to pcr_shop_list)
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN pcr_shop_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
-- Stable PCR customer identifier (normalized shop name or AccountEdge card id).
-- Populated by syncPCRCustomers() so name tweaks in AccountEdge don't create duplicates.
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN pcr_customer_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_accounts_pcr_customer_id ON accounts(pcr_customer_id) WHERE pcr_customer_id IS NOT NULL;
-- Last time PCR sync touched this record (for staleness detection)
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN pcr_last_synced_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_category ON accounts(account_category);
CREATE INDEX IF NOT EXISTS idx_accounts_branch ON accounts(branch);
CREATE INDEX IF NOT EXISTS idx_accounts_secondary_rep ON accounts(secondary_rep_id);
CREATE INDEX IF NOT EXISTS idx_accounts_pcr_managed ON accounts(pcr_managed) WHERE pcr_managed = true;

-- ─── ACCOUNT IMPORT EXCLUSION ──────────────────────────────────────
-- Set when a manager archives a shop from the No Activity report. The account and
-- its history stay fully browsable in the CRM; the flag tells the AccountEdge / PCR
-- match logic to skip this row so a re-emerging shop comes in as a fresh card rather
-- than attaching new sales to a known-defunct record.
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN excluded_from_import BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN excluded_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN excluded_by_user_id INTEGER REFERENCES users(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN exclusion_reason TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_accounts_excluded_from_import ON accounts(excluded_from_import) WHERE excluded_from_import = true;

-- ─── AUDIT LOG APPEND-ONLY PROTECTION ───────────────────────────────
-- The audit_log is forensic evidence; reject any UPDATE or DELETE attempts
-- at the database level so even a compromised backend cannot alter history.
CREATE OR REPLACE FUNCTION audit_log_block_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modify();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_modify();

-- ─── CUSTOMER ALERT DISMISSALS ──────────────────────────────────────
-- Managers/admins can permanently remove a customer from the alerts page
-- (e.g. shop closed, no longer carries PPG, etc.). Stored separately so the
-- alerts query can compute lapsed customers fresh and just filter out dismissed ones.
CREATE TABLE IF NOT EXISTS customer_alert_dismissals (
  id SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('closed', 'no_longer_ppg', 'other')),
  notes TEXT,
  account_id INTEGER REFERENCES accounts(id),
  dismissed_by_id INTEGER REFERENCES users(id),
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_alert_dismissals_name_lower
  ON customer_alert_dismissals (LOWER(customer_name));

-- ─── COMPETITIVE MARKET INFO ────────────────────────────────────────
-- Team-shared library of competitor price lists, promotion flyers, scans, etc.
-- File bytes live in the DB so they survive Render redeploys (no persistent disk).
CREATE TABLE IF NOT EXISTS competitive_market_info (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_data BYTEA NOT NULL,
  uploaded_by_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitive_market_info_created ON competitive_market_info(created_at DESC);

-- Add structured search fields to competitive_market_info so reps can pull up
-- a promo by manufacturer name, SKU, or product code without scanning notes.
DO $$ BEGIN
  ALTER TABLE competitive_market_info ADD COLUMN manufacturer TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE competitive_market_info ADD COLUMN product_codes TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_cmi_manufacturer_lower ON competitive_market_info (LOWER(manufacturer));

-- ─── HOLDS (synced from CHC Intranet) ──────────────────────────────
CREATE TABLE IF NOT EXISTS holds (
  id            SERIAL PRIMARY KEY,
  intranet_id   TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  branch        TEXT,
  reason        TEXT,
  added_at      TIMESTAMPTZ,
  added_by      TEXT,
  updates       JSONB DEFAULT '[]'::jsonb,
  intranet_updated_at TIMESTAMPTZ,
  account_id    INT REFERENCES accounts(id) ON DELETE SET NULL,
  rep_id        INT REFERENCES users(id) ON DELETE SET NULL,
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_holds_is_active ON holds(is_active);
CREATE INDEX IF NOT EXISTS idx_holds_rep_id ON holds(rep_id);
CREATE INDEX IF NOT EXISTS idx_holds_account_id ON holds(account_id);
CREATE INDEX IF NOT EXISTS idx_holds_branch ON holds(branch);

-- ─── NOTE COMMENTS (threaded coaching/replies) ────────────────────
CREATE TABLE IF NOT EXISTS note_comments (
  id                SERIAL PRIMARY KEY,
  note_id           INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  author_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id INT REFERENCES note_comments(id) ON DELETE CASCADE,
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_note_comments_note_id ON note_comments(note_id);
CREATE INDEX IF NOT EXISTS idx_note_comments_author_id ON note_comments(author_id);

-- ─── REFRESH HOLDS FUNCTION ────────────────────────────────────────
-- Placeholder: returns summary. In production, populate holds via external sync
-- or call this after an ETL job populates the holds table.
CREATE OR REPLACE FUNCTION public.refresh_holds_from_intranet()
RETURNS jsonb AS $$
DECLARE
  active_count int;
  unassigned_count int;
BEGIN
  SELECT COUNT(*) INTO active_count FROM holds WHERE is_active = true;
  SELECT COUNT(*) INTO unassigned_count FROM holds WHERE is_active = true AND rep_id IS NULL;
  RETURN jsonb_build_object(
    'active', active_count,
    'unassigned', unassigned_count,
    'refreshed_at', NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- ─── FIX SERIAL SEQUENCES ──────────────────────────────────────────
-- After bulk imports, serial sequences can fall behind the actual max id,
-- causing "duplicate key violates unique constraint" on the next INSERT.
-- This resets every sequence to MAX(id)+1 on each deploy (safe to re-run).
SELECT setval('activities_id_seq',  COALESCE((SELECT MAX(id) FROM activities),  0) + 1, false);
SELECT setval('notes_id_seq',       COALESCE((SELECT MAX(id) FROM notes),       0) + 1, false);
SELECT setval('accounts_id_seq',    COALESCE((SELECT MAX(id) FROM accounts),    0) + 1, false);
SELECT setval('sales_data_id_seq',  COALESCE((SELECT MAX(id) FROM sales_data),  0) + 1, false);
SELECT setval('users_id_seq',       COALESCE((SELECT MAX(id) FROM users),       0) + 1, false);
SELECT setval('audit_log_id_seq',   COALESCE((SELECT MAX(id) FROM audit_log),   0) + 1, false);
