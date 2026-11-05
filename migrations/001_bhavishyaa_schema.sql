-- ============================================================================
-- BHAVISHYAA Panel — Production Database Schema Migration
-- Compatible with Supabase PostgreSQL & @supabase/supabase-js
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. USERS & BALANCES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'agency')),
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0.00),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- ----------------------------------------------------------------------------
-- 2. ACCESS KEYS TABLE (Licensing & Device Binding)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.access_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  duration_seconds BIGINT,
  expires_at TIMESTAMPTZ,
  fingerprint TEXT,
  activated_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- ----------------------------------------------------------------------------
-- 3. ORDERS TABLE (Master Order Record)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  scheduler_order_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  link TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' 
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  total_views BIGINT NOT NULL DEFAULT 0,
  total_charge NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'USD',
  idempotency_key TEXT UNIQUE,
  scheduled_end_time TIMESTAMPTZ NOT NULL,
  reminder_deadline TIMESTAMPTZ,
  reminder_status TEXT DEFAULT 'scheduled'
    CHECK (reminder_status IN ('scheduled', 'dispatching', 'sent', 'dismissed', 'extended', 'ended_as_scheduled', 'failed')),
  reminder_sent_at TIMESTAMPTZ,
  reminder_prompt TEXT,
  reminder_version TEXT,
  extended_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 4. ORDER RUNS TABLE (Discrete Cadence Executions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  run_number INT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  saves BIGINT NOT NULL DEFAULT 0,
  reposts BIGINT NOT NULL DEFAULT 0,
  comments TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'completed', 'skipped', 'cancelling', 'cancelled', 'failed')),
  provider_order_ids JSONB DEFAULT '{}'::jsonb,
  skip_reason TEXT,
  error TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_order_run_number UNIQUE (order_id, run_number)
);

-- ----------------------------------------------------------------------------
-- 5. AUDIT LOGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT,
  order_id TEXT,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- ----------------------------------------------------------------------------
-- 6. IDEMPOTENCY KEYS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  status_code INT NOT NULL DEFAULT 200,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '24 hours')
);

-- ----------------------------------------------------------------------------
-- 7. PERFORMANCE & LOOKUP INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_end ON public.orders (scheduled_end_time);
CREATE INDEX IF NOT EXISTS idx_orders_reminder_lookup ON public.orders (reminder_status, reminder_deadline);
CREATE INDEX IF NOT EXISTS idx_order_runs_lookup ON public.order_runs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_order_runs_order_id ON public.order_runs (order_id);
CREATE INDEX IF NOT EXISTS idx_audit_order_id ON public.audit_logs (order_id);

-- ----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Users: Users can view their own profile
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (auth.uid()::text = id OR current_setting('role') = 'service_role');

-- Orders: Users can read and create their own orders
CREATE POLICY "Users read own orders" ON public.orders
  FOR SELECT USING (auth.uid()::text = user_id OR current_setting('role') = 'service_role');

CREATE POLICY "Users insert own orders" ON public.orders
  FOR INSERT WITH CHECK (auth.uid()::text = user_id OR current_setting('role') = 'service_role');

CREATE POLICY "Users update own orders" ON public.orders
  FOR UPDATE USING (auth.uid()::text = user_id OR current_setting('role') = 'service_role');

-- Order Runs: Users can view runs of their own orders
CREATE POLICY "Users read own order runs" ON public.order_runs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders WHERE orders.id = order_runs.order_id AND (orders.user_id = auth.uid()::text OR current_setting('role') = 'service_role'))
  );

-- Service Role Full Administrative Access for Backend Scheduler
CREATE POLICY "Service role full access orders" ON public.orders
  FOR ALL USING (current_setting('role') = 'service_role');

CREATE POLICY "Service role full access order_runs" ON public.order_runs
  FOR ALL USING (current_setting('role') = 'service_role');

CREATE POLICY "Service role full access users" ON public.users
  FOR ALL USING (current_setting('role') = 'service_role');

CREATE POLICY "Service role full access audit_logs" ON public.audit_logs
  FOR ALL USING (current_setting('role') = 'service_role');

-- Access Keys: Strictly protected against anonymous visitor enumeration (Prevents terminal key leakage)
CREATE POLICY "Service role full access access_keys" ON public.access_keys
  FOR ALL USING (current_setting('role') = 'service_role');

DROP POLICY IF EXISTS "Public read access keys" ON public.access_keys;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.access_keys;
REVOKE ALL ON public.access_keys FROM anon;
REVOKE ALL ON public.access_keys FROM authenticated;
GRANT ALL ON public.access_keys TO service_role;

-- ----------------------------------------------------------------------------
-- 9. ATOMIC JOB CLAIM STORED PROCEDURE (Distributed Concurrency Lock)
-- Enforces Rule 1 & 2 atomically using FOR UPDATE SKIP LOCKED
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_next_run(
  p_queue_id TEXT,
  p_max_latency_seconds INT DEFAULT 60
)
RETURNS TABLE (
  claimed_run_id UUID,
  order_id TEXT,
  run_number INT,
  views BIGINT,
  likes BIGINT,
  shares BIGINT,
  saves BIGINT,
  reposts BIGINT,
  comments TEXT,
  status TEXT,
  scheduled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_run_record RECORD;
BEGIN
  -- Look for next pending run whose scheduled time has arrived
  SELECT r.id, r.order_id, r.run_number, r.views, r.likes, r.shares, r.saves, r.reposts, r.comments, r.status, r.scheduled_at
  INTO v_run_record
  FROM public.order_runs r
  JOIN public.orders o ON o.id = r.order_id
  WHERE r.status = 'pending'
    AND r.scheduled_at <= v_now
    AND o.link ILIKE ('%' || p_queue_id || '%')
    AND o.status = 'running'
  ORDER BY r.scheduled_at ASC
  LIMIT 1
  FOR UPDATE OF r SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Check if expired past latency window (Rule 3 & 4)
  IF (EXTRACT(EPOCH FROM (v_now - v_run_record.scheduled_at))) > p_max_latency_seconds THEN
    UPDATE public.order_runs
    SET status = 'skipped',
        skip_reason = 'Skipped: Missed scheduled execution window by ' || ROUND(EXTRACT(EPOCH FROM (v_now - v_run_record.scheduled_at))) || 's. Rule 4: never started late.'
    WHERE id = v_run_record.id;
    RETURN;
  END IF;

  -- Atomically claim run (Rule 1 & 2)
  UPDATE public.order_runs
  SET status = 'executing',
      started_at = v_now
  WHERE id = v_run_record.id;

  RETURN QUERY
  SELECT v_run_record.id, v_run_record.order_id, v_run_record.run_number, 
         v_run_record.views, v_run_record.likes, v_run_record.shares, 
         v_run_record.saves, v_run_record.reposts, v_run_record.comments, 
         'executing'::TEXT, v_run_record.scheduled_at;
END;
$$;
