-- Migration: Multi-user auth, profiles table, first user is admin, auto-link existing trips, RLS policies
-- Date: 2026-09-29T23:25:00.000Z

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'solicitante' CHECK (role IN ('admin', 'solicitante')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on role
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 2. Helper function to check if current user is admin (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND role = 'admin'
      AND is_active = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Trigger function to handle new auth.users signup
-- Rule: The very first user created in the system automatically becomes 'admin'.
-- And all existing trips with NULL user_id are assigned to this first admin user.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_existing_users_count INT;
  v_assigned_role TEXT;
  v_full_name TEXT;
BEGIN
  -- Count existing profiles to determine if this is the first user
  SELECT COUNT(*) INTO v_existing_users_count FROM public.profiles;

  -- First registered user is automatically 'admin', otherwise default to role in metadata or 'solicitante'
  IF v_existing_users_count = 0 THEN
    v_assigned_role := 'admin';
  ELSE
    v_assigned_role := COALESCE(NEW.raw_user_meta_data->>'role', 'solicitante');
    IF v_assigned_role NOT IN ('admin', 'solicitante') THEN
      v_assigned_role := 'solicitante';
    END IF;
  END IF;

  -- Extract full_name from user_metadata (default to email prefix if absent)
  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1)
  );

  -- Insert profile
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    v_full_name,
    v_assigned_role,
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = CASE WHEN profiles.full_name = '' THEN EXCLUDED.full_name ELSE profiles.full_name END;

  -- If this is the first user (or role is admin and unassigned trips exist),
  -- bind all legacy trips with NULL user_id to this user!
  IF v_assigned_role = 'admin' THEN
    UPDATE public.trips
    SET user_id = NEW.id
    WHERE user_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies:
-- Users can read their own profile, or admins can read all profiles
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR public.is_admin(auth.uid())
  );

-- Users can update their own profile (name), but only admins can change roles
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid() OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    -- If non-admin updating own profile, role and is_active must remain unchanged
    public.is_admin(auth.uid()) OR (
      id = auth.uid() AND
      role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) AND
      is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

-- Only admins can insert new profiles directly (normal users are inserted via trigger)
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid() OR public.is_admin(auth.uid())
  );

-- 5. Update RLS policies on trips
-- Drop old permissive policies
DROP POLICY IF EXISTS "anon_trips_select" ON public.trips;
DROP POLICY IF EXISTS "anon_trips_insert" ON public.trips;
DROP POLICY IF EXISTS "anon_trips_update" ON public.trips;
DROP POLICY IF EXISTS "anon_trips_delete" ON public.trips;
DROP POLICY IF EXISTS "trips_select_policy" ON public.trips;
DROP POLICY IF EXISTS "trips_insert_policy" ON public.trips;
DROP POLICY IF EXISTS "trips_update_policy" ON public.trips;
DROP POLICY IF EXISTS "trips_delete_policy" ON public.trips;

-- Users see their own trips, or legacy trips with NULL user_id, or admins see all
CREATE POLICY "trips_select_policy" ON public.trips
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR public.is_admin(auth.uid())
  );

-- Users can insert trips for themselves (or admin for any)
CREATE POLICY "trips_insert_policy" ON public.trips
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_admin(auth.uid()))
    OR public.is_admin(auth.uid())
  );

-- Users can update their own trips; admin can update any
CREATE POLICY "trips_update_policy" ON public.trips
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (user_id IS NULL AND public.is_admin(auth.uid()))
    OR public.is_admin(auth.uid())
  );

-- Users can delete their own trips (subject to trigger check_trip_delete_allowed); admin can delete any
CREATE POLICY "trips_delete_policy" ON public.trips
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

-- 6. Update RLS policies on expenses
-- Drop old permissive policies
DROP POLICY IF EXISTS "anon_expenses_select" ON public.expenses;
DROP POLICY IF EXISTS "anon_expenses_insert" ON public.expenses;
DROP POLICY IF EXISTS "anon_expenses_update" ON public.expenses;
DROP POLICY IF EXISTS "anon_expenses_delete" ON public.expenses;
DROP POLICY IF EXISTS "expenses_select_policy" ON public.expenses;
DROP POLICY IF EXISTS "expenses_insert_policy" ON public.expenses;
DROP POLICY IF EXISTS "expenses_update_policy" ON public.expenses;
DROP POLICY IF EXISTS "expenses_delete_policy" ON public.expenses;

CREATE POLICY "expenses_select_policy" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "expenses_insert_policy" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "expenses_update_policy" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "expenses_delete_policy" ON public.expenses
  FOR DELETE TO authenticated
  USING (
    trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

-- 7. Update RLS policies on audit_rules_log
DROP POLICY IF EXISTS "anon_audit_rules_log_select" ON public.audit_rules_log;
DROP POLICY IF EXISTS "anon_audit_rules_log_insert" ON public.audit_rules_log;
DROP POLICY IF EXISTS "anon_audit_rules_log_update" ON public.audit_rules_log;
DROP POLICY IF EXISTS "anon_audit_rules_log_delete" ON public.audit_rules_log;
DROP POLICY IF EXISTS "audit_rules_log_select_policy" ON public.audit_rules_log;
DROP POLICY IF EXISTS "audit_rules_log_insert_policy" ON public.audit_rules_log;
DROP POLICY IF EXISTS "audit_rules_log_update_policy" ON public.audit_rules_log;
DROP POLICY IF EXISTS "audit_rules_log_delete_policy" ON public.audit_rules_log;

CREATE POLICY "audit_rules_log_select_policy" ON public.audit_rules_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "audit_rules_log_insert_policy" ON public.audit_rules_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "audit_rules_log_update_policy" ON public.audit_rules_log
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

CREATE POLICY "audit_rules_log_delete_policy" ON public.audit_rules_log
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
    OR public.is_admin(auth.uid())
  );

-- 8. Storage policies for comprovantes bucket
DROP POLICY IF EXISTS "public_comprovantes_read" ON storage.objects;
DROP POLICY IF EXISTS "public_comprovantes_insert" ON storage.objects;
DROP POLICY IF EXISTS "public_comprovantes_update" ON storage.objects;
DROP POLICY IF EXISTS "public_comprovantes_delete" ON storage.objects;

-- All authenticated users can read comprovantes (and public since bucket is public for previews)
CREATE POLICY "authenticated_comprovantes_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'comprovantes');

CREATE POLICY "authenticated_comprovantes_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovantes');

CREATE POLICY "authenticated_comprovantes_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'comprovantes')
  WITH CHECK (bucket_id = 'comprovantes');

CREATE POLICY "authenticated_comprovantes_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'comprovantes');
