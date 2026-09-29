-- Enable pgcrypto if needed for UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Table: trips
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  destination TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  transport_type TEXT NOT NULL CHECK (transport_type IN ('aéreo', 'carro_proprio', 'carro_alugado', 'outros')),
  status TEXT NOT NULL DEFAULT 'em_triagem' CHECK (status IN ('em_triagem', 'com_pendencias', 'auditada', 'fechada', 'reembolsada')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  motivo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Table: expenses
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  issue_date DATE NOT NULL,
  issue_time TEXT,
  category TEXT NOT NULL CHECK (category IN ('transporte', 'alimentacao', 'hospedagem', 'pedagio', 'combustivel', 'uber_taxi', 'estacionamento', 'outros')),
  merchant_name TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  ocr_raw_text TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  audit_flags TEXT[] NOT NULL DEFAULT '{}',
  audit_status TEXT NOT NULL DEFAULT 'pendente' CHECK (audit_status IN ('pendente', 'conforme', 'justificado')),
  audit_justification TEXT,
  cnpj TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Table: audit_rules_log
CREATE TABLE IF NOT EXISTS public.audit_rules_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.trips(id) ON DELETE CASCADE NOT NULL,
  rule_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'justified')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trips_status ON public.trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_start_date ON public.trips(start_date);
CREATE INDEX IF NOT EXISTS idx_expenses_trip_id ON public.expenses(trip_id);
CREATE INDEX IF NOT EXISTS idx_expenses_issue_date ON public.expenses(issue_date);
CREATE INDEX IF NOT EXISTS idx_audit_rules_log_trip_id ON public.audit_rules_log(trip_id);

-- Enable RLS
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_rules_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trips (allow anon and authenticated)
DROP POLICY IF EXISTS "anon_trips_select" ON public.trips;
CREATE POLICY "anon_trips_select" ON public.trips FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_trips_insert" ON public.trips;
CREATE POLICY "anon_trips_insert" ON public.trips FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_trips_update" ON public.trips;
CREATE POLICY "anon_trips_update" ON public.trips FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_trips_delete" ON public.trips;
CREATE POLICY "anon_trips_delete" ON public.trips FOR DELETE TO anon, authenticated USING (true);

-- RLS Policies for expenses (allow anon and authenticated)
DROP POLICY IF EXISTS "anon_expenses_select" ON public.expenses;
CREATE POLICY "anon_expenses_select" ON public.expenses FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_expenses_insert" ON public.expenses;
CREATE POLICY "anon_expenses_insert" ON public.expenses FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_expenses_update" ON public.expenses;
CREATE POLICY "anon_expenses_update" ON public.expenses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_expenses_delete" ON public.expenses;
CREATE POLICY "anon_expenses_delete" ON public.expenses FOR DELETE TO anon, authenticated USING (true);

-- RLS Policies for audit_rules_log (allow anon and authenticated)
DROP POLICY IF EXISTS "anon_audit_rules_log_select" ON public.audit_rules_log;
CREATE POLICY "anon_audit_rules_log_select" ON public.audit_rules_log FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_audit_rules_log_insert" ON public.audit_rules_log;
CREATE POLICY "anon_audit_rules_log_insert" ON public.audit_rules_log FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_audit_rules_log_update" ON public.audit_rules_log;
CREATE POLICY "anon_audit_rules_log_update" ON public.audit_rules_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_audit_rules_log_delete" ON public.audit_rules_log;
CREATE POLICY "anon_audit_rules_log_delete" ON public.audit_rules_log FOR DELETE TO anon, authenticated USING (true);

-- 4. Storage Bucket: comprovantes
INSERT INTO storage.buckets (id, name, public)
VALUES ('comprovantes', 'comprovantes', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS Policies
DROP POLICY IF EXISTS "public_comprovantes_read" ON storage.objects;
CREATE POLICY "public_comprovantes_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'comprovantes');

DROP POLICY IF EXISTS "public_comprovantes_insert" ON storage.objects;
CREATE POLICY "public_comprovantes_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'comprovantes');

DROP POLICY IF EXISTS "public_comprovantes_update" ON storage.objects;
CREATE POLICY "public_comprovantes_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'comprovantes');

DROP POLICY IF EXISTS "public_comprovantes_delete" ON storage.objects;
CREATE POLICY "public_comprovantes_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'comprovantes');
