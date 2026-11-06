-- Migration: Create app_settings table for system configurations like Azul point conversion rate
-- Date: 2026-11-06T18:00:00.000Z

CREATE TABLE IF NOT EXISTS public.app_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  azul_point_rate NUMERIC NOT NULL DEFAULT 0.017,
  description TEXT DEFAULT 'Configurações gerais do sistema',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Seed initial row if not exists
INSERT INTO public.app_settings (id, azul_point_rate, description)
VALUES ('default', 0.017, 'Taxa padrão de conversão Azul (R$ por ponto/milha)')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Select policy: Any authenticated user can read settings
DROP POLICY IF EXISTS "app_settings_select_policy" ON public.app_settings;
CREATE POLICY "app_settings_select_policy" ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

-- Update policy: Authenticated users (admin or general logged-in user) can update settings
DROP POLICY IF EXISTS "app_settings_update_policy" ON public.app_settings;
CREATE POLICY "app_settings_update_policy" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert policy: Authenticated users can insert if id doesn't exist
DROP POLICY IF EXISTS "app_settings_insert_policy" ON public.app_settings;
CREATE POLICY "app_settings_insert_policy" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Grant permissions explicitly to authenticated and service_role
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT ON TABLE public.app_settings TO anon;

-- Recarregar o schema cache do PostgREST para expor a tabela imediatamente na API
NOTIFY pgrst, 'reload schema';
