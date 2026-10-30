-- Migration: Estabelecer Foreign Key entre standalone_requests/trips e public.profiles
-- Permite embeds do PostgREST (ex.: .select('*, user_profile:profiles(*)'))
-- e recarrega o schema cache do PostgREST.

-- 1. Assegurar que todos os usuários de auth.users possuam registro correspondente em public.profiles
INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
SELECT 
  u.id,
  COALESCE(u.email, ''),
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1), 'Usuário'),
  'solicitante',
  true,
  now(),
  now()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- 2. Adicionar FK de standalone_requests.user_id -> public.profiles(id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'standalone_requests_user_id_profiles_fkey'
      AND table_name = 'standalone_requests'
  ) THEN
    ALTER TABLE public.standalone_requests
      ADD CONSTRAINT standalone_requests_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Adicionar FK de trips.user_id -> public.profiles(id) se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'trips_user_id_profiles_fkey'
      AND table_name = 'trips'
  ) THEN
    ALTER TABLE public.trips
      ADD CONSTRAINT trips_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Criar índices para otimização de joins com profiles
CREATE INDEX IF NOT EXISTS idx_standalone_requests_user_id_profiles ON public.standalone_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_user_id_profiles ON public.trips(user_id);

-- 5. Recarregar o schema cache do PostgREST para reconhecer a nova relação imediatamente
NOTIFY pgrst, 'reload schema';
