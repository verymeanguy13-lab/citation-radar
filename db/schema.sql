-- CitationRadar -- Database Schema
-- Run once in the Neon SQL Editor after Session 3.
-- CORRECTIONS: append later ALTER statements as a new dated migration block
-- at the bottom of this file. Never edit an existing CREATE TABLE in place.

CREATE TABLE IF NOT EXISTS cities (
  code VARCHAR(3) PRIMARY KEY, -- 'NYC' | 'TOR'
  name TEXT NOT NULL,
  country VARCHAR(2) NOT NULL, -- 'US' | 'CA'
  currency VARCHAR(3) NOT NULL, -- 'USD' | 'CAD'
  data_source_name TEXT NOT NULL,
  data_source_license TEXT NOT NULL,
  timezone TEXT NOT NULL
);

INSERT INTO cities (code, name, country, currency, data_source_name, data_source_license, timezone) VALUES
('NYC', 'New York City', 'US', 'USD', 'DOHMH Restaurant Inspection Results', 'NYC Local Law 11 of 2012 -- no restrictions', 'America/New_York'),
('TOR', 'Toronto', 'CA', 'CAD', 'DineSafe', 'Open Government Licence - Toronto', 'America/Toronto')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS establishments (
  id SERIAL PRIMARY KEY,
  city_code VARCHAR(3) NOT NULL REFERENCES cities(code),
  external_id TEXT NOT NULL, -- CAMIS (NYC) or Establishment ID (Toronto)
  legal_name TEXT NOT NULL,
  dba_name TEXT,
  address TEXT,
  area TEXT, -- borough (NYC) or ward (Toronto)
  postal_code TEXT,
  cuisine_type TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  phone TEXT, -- NYC: native PHONE field, free. Toronto: TBD in Session 5 Step 0.
  website TEXT, -- populated only if a free source provides it -- see Section 1.3
  data_source_notes TEXT, -- records where contact data actually came from, per establishment
  source_row_hash TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (city_code, external_id)
);

CREATE INDEX IF NOT EXISTS idx_establishments_city ON establishments(city_code);

CREATE TABLE IF NOT EXISTS violations (
  id SERIAL PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  city_code VARCHAR(3) NOT NULL REFERENCES cities(code), -- denormalized on purpose: see Section 3
  inspection_date DATE,
  violation_code TEXT,
  violation_description TEXT,
  category TEXT, -- normalized: 'pest' | 'sanitation' | 'temperature' | 'other'
  critical_flag BOOLEAN DEFAULT FALSE,
  score INTEGER,
  grade TEXT, -- NYC: 'A'/'B'/'C'; Toronto: pass/conditional/closed
  source_row_hash TEXT,
  ingested_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_violations_establishment ON violations(establishment_id);
CREATE INDEX IF NOT EXISTS idx_violations_city ON violations(city_code);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(inspection_date);
CREATE INDEX IF NOT EXISTS idx_violations_category ON violations(category);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  business_name TEXT,
  buyer_category VARCHAR(30) CHECK (buyer_category IN ('pest_control','cleaning','refrigeration','food_safety_consultant','restaurant_consultant')),
  plan VARCHAR(10) CHECK (plan IN ('free','pro')) DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  city_code VARCHAR(3) NOT NULL REFERENCES cities(code), -- REQUIRED. Never nullable. See Section 3.
  label TEXT,
  category_filter TEXT,
  min_severity TEXT,
  area_filter TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_city ON saved_searches(city_code);

CREATE TABLE IF NOT EXISTS search_matches (
  id SERIAL PRIMARY KEY,
  saved_search_id INTEGER NOT NULL REFERENCES saved_searches(id),
  violation_id INTEGER NOT NULL REFERENCES violations(id),
  matched_city_code VARCHAR(3) NOT NULL, -- denormalized copy, checked by trigger below
  sent_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (saved_search_id, violation_id)
);

-- SAFETY NET: a saved_search and the violation it matches must be the same city.
-- This is enforced in application code (Session 10) AND here, as a second,
-- independent layer -- if the app logic ever has a bug, the database itself
-- refuses to insert a cross-city match rather than silently allowing one.

CREATE OR REPLACE FUNCTION enforce_city_match() RETURNS TRIGGER AS $$
DECLARE
  search_city VARCHAR(3);
  violation_city VARCHAR(3);
BEGIN
  SELECT city_code INTO search_city FROM saved_searches WHERE id = NEW.saved_search_id;
  SELECT city_code INTO violation_city FROM violations WHERE id = NEW.violation_id;
  IF search_city IS DISTINCT FROM violation_city THEN
    RAISE EXCEPTION 'City mismatch: saved_search city=%, violation city=%. Cross-city match blocked.', search_city, violation_city;
  END IF;
  NEW.matched_city_code := search_city;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_city_match ON search_matches;
CREATE TRIGGER trg_enforce_city_match
BEFORE INSERT ON search_matches
FOR EACH ROW EXECUTE FUNCTION enforce_city_match();

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id SERIAL PRIMARY KEY,
  city_code VARCHAR(3) NOT NULL REFERENCES cities(code),
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(10) CHECK (status IN ('success','partial','failed','no_new_data')),
  rows_fetched INTEGER,
  rows_inserted INTEGER,
  rows_updated INTEGER,
  median_lag_days NUMERIC, -- median(source_published_at - inspection_date) this run
  notes TEXT,
  alert_sent BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_city ON ingestion_runs(city_code);

CREATE TABLE IF NOT EXISTS prospects (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  buyer_category VARCHAR(30), -- matches users.buyer_category enum
  city_code VARCHAR(3) REFERENCES cities(code),
  registry_city TEXT, -- raw city/zip from source registry (e.g. DEC)
  zip_code TEXT,
  source TEXT, -- e.g. 'ny_dec_pesticide_registry'
  website TEXT,
  contact_method VARCHAR(20) CHECK (contact_method IN ('osm_website','domain_guess','manual_maps','none')),
  contacted BOOLEAN DEFAULT FALSE,
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prospects_category ON prospects(buyer_category);
CREATE INDEX IF NOT EXISTS idx_prospects_contacted ON prospects(contacted);
-- Migration (Session 6, dated 2026-08-15): track which ingestion_runs
-- were one-time backfills, so monitoring's "typical volume" baseline
-- (Section 6, check b) isn't skewed by the initial 90-day pulls.
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS is_initial_run BOOLEAN DEFAULT FALSE;

-- Migration (Session 8, dated 2026-08-16): email verification support.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Migration (Session 12, dated 2026-08-17): admin dashboard support.
-- is_admin gates access to /admin. qa_reviewed_at lets an admin dismiss
-- a violation from the 'other'-category QA queue once it's been looked at.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE violations ADD COLUMN IF NOT EXISTS qa_reviewed_at TIMESTAMPTZ;

-- Migration (Session 13, dated 2026-08-17): Paddle integration.
-- paddle_customer_id / paddle_subscription_id link our user to Paddle's
-- own records. paddle_subscription_status holds Paddle's raw status
-- (active, canceled, past_due, paused) for admin visibility -- the
-- simpler 'plan' column (free/pro) is what the app's own tier-gating
-- logic actually checks, kept separate on purpose.
ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS paddle_subscription_status TEXT;
