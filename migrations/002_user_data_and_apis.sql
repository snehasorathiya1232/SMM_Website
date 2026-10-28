-- ============================================================================
-- BHAVISHYAA Panel — Migration 002: User Login Info, SMM APIs & Configs
-- ============================================================================

-- 1. EXTEND USERS TABLE (Add login info, plain password, password hash, name, username, plan)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'Starter Pacing Pro';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS token TEXT;

-- 2. CREATE SMM APIS TABLE (Stores API Name, API Key, ID, URL, Currency, Balance)
CREATE TABLE IF NOT EXISTS public.user_apis (
  id TEXT PRIMARY KEY,                             -- e.g. 'api-yoyo-1'
  user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                              -- e.g. 'Yoyo SMM'
  url TEXT NOT NULL,                               -- e.g. 'https://yoyosmm.com/api/v2'
  api_key TEXT NOT NULL,                           -- Live SMM API Key
  currency TEXT DEFAULT 'INR',                     -- e.g. 'INR', 'USD'
  exchange_rate_to_inr NUMERIC(10, 4) DEFAULT 1.0, 
  balance NUMERIC(12, 2) DEFAULT 0.00,
  services JSONB DEFAULT '[]'::jsonb,              -- List of services with rates
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- 3. CREATE USER CONFIGS TABLE (Stores Bundles, Ratios, Presets)
CREATE TABLE IF NOT EXISTS public.user_configs (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  bundles JSONB DEFAULT '[]'::jsonb,
  active_ratios JSONB DEFAULT '{"likes": 2.5, "shares": 1.75, "saves": 0.45, "comments": 0.05, "reposts": 0.85}'::jsonb,
  ratio_presets JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- 4. ENABLE ROW LEVEL SECURITY & PERMISSIONS
ALTER TABLE public.user_apis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access user_apis" ON public.user_apis;
CREATE POLICY "Service role full access user_apis" ON public.user_apis
  FOR ALL USING (TRUE);

DROP POLICY IF EXISTS "Service role full access user_configs" ON public.user_configs;
CREATE POLICY "Service role full access user_configs" ON public.user_configs
  FOR ALL USING (TRUE);

-- 5. INSERT DEFAULT MASTER USER & API IF NOT ALREADY PRESENT
INSERT INTO public.users (id, name, username, email, password, role, balance, plan)
VALUES (
  'usr-admin-01',
  'Admin',
  'admin',
  'snehasorathiya1@gmail.com',
  'admin123',
  'admin',
  1000.00,
  'Agency Lead'
)
ON CONFLICT (id) DO UPDATE 
SET password = EXCLUDED.password,
    name = EXCLUDED.name;

INSERT INTO public.user_apis (id, user_id, name, url, api_key, currency, exchange_rate_to_inr, balance)
VALUES (
  'api-yoyo-1',
  'usr-admin-01',
  'Yoyo',
  'https://yoyosmm.com/api/v2',
  'demo_yoyo_key_sec_8921',
  'INR',
  1.0,
  8.50
)
ON CONFLICT (id) DO NOTHING;

