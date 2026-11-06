-- Migration: Ensure app_settings table and fallback column in profiles for Azul point conversion rate
-- Date: 2026-11-06T19:00:00.000Z

-- 1. Ensure app_settings exists with relaxed RLS and explicit grants
CREATE TABLE IF NOT EXISTS public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  azul_point_rate NUMERIC NOT NULL DEFAULT 0.017,
  description TEXT DEFAULT 'Configurações gerais do sistema',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Seed initial default row if missing
INSERT INTO public.app_settings (id, azul_point_rate, description)
VALUES ('default', 0.017, 'Taxa padrão de conversão Azul (R$ por ponto/milha)')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on app_settings
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Select policy: Allow authenticated and anon (or true)
DROP POLICY IF EXISTS "app_settings_select_policy" ON public.app_settings;
CREATE POLICY "app_settings_select_policy" ON public.app_settings
  FOR SELECT
  TO public
  USING (true);

-- Update policy: Allow authenticated users to update
DROP POLICY IF EXISTS "app_settings_update_policy" ON public.app_settings;
CREATE POLICY "app_settings_update_policy" ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert policy: Allow authenticated users to insert
DROP POLICY IF EXISTS "app_settings_insert_policy" ON public.app_settings;
CREATE POLICY "app_settings_insert_policy" ON public.app_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Explicit Grants
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT ON TABLE public.app_settings TO anon;

-- 2. PLANO B FALLBACK: Add azul_point_rate to public.profiles table
-- This guarantees persistence even if app_settings is somehow inaccessible or pending cache reload in PostgREST
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS azul_point_rate NUMERIC DEFAULT 0.017;

-- 3. Notify PostgREST schema reload
NOTIFY pgrst, 'reload schema';
