-- Migration: Fix visibility of legacy trips, ensure admin privileges, fix RLS recursion and self-healing for profiles and orphan trips
-- Date: 2026-09-30T00:15:00.000Z

-- 1. Helper function: check if a user is admin.
-- Must use SECURITY DEFINER and SET search_path = public to avoid RLS recursion on public.profiles.
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = p_user_id
    AND is_active = true;

  RETURN COALESCE(v_role = 'admin', FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Function to auto-claim orphan trips to the designated or first admin user
-- SECURITY DEFINER allows it to reassign trips without being blocked by RLS
CREATE OR REPLACE FUNCTION public.claim_orphan_trips(p_target_user_id UUID DEFAULT NULL)
RETURNS INT AS $$
DECLARE
  v_admin_id UUID := p_target_user_id;
  v_updated INT := 0;
BEGIN
  -- If no target user provided, try current auth.uid() if admin, or find any active admin
  IF v_admin_id IS NULL THEN
    IF public.is_admin(auth.uid()) THEN
      v_admin_id := auth.uid();
    ELSE
      SELECT id INTO v_admin_id
      FROM public.profiles
      WHERE role = 'admin' AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_admin_id IS NOT NULL THEN
    UPDATE public.trips
    SET user_id = v_admin_id
    WHERE user_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
  END IF;

  RETURN v_updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Enhance or replace handle_new_user trigger
-- Ensures that if no admin exists, this user is admin.
-- If user is admin (or the only user), bind all orphan trips.
-- Also ensure seed admin or luiz@globexmultimodal.com.br is guaranteed admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_existing_users_count INT;
  v_admin_count INT;
  v_assigned_role TEXT;
  v_full_name TEXT;
BEGIN
  -- Count existing profiles
  SELECT COUNT(*) INTO v_existing_users_count FROM public.profiles;
  SELECT COUNT(*) INTO v_admin_count FROM public.profiles WHERE role = 'admin' AND is_active = true;

  -- First registered user is automatically admin.
  -- Or if there is currently NO admin in the system, this user becomes admin.
  -- Or if metadata says admin.
  -- Or if email matches main admin luiz@globexmultimodal.com.br
  IF v_existing_users_count = 0 OR v_admin_count = 0 OR LOWER(COALESCE(NEW.email, '')) = 'luiz@globexmultimodal.com.br' THEN
    v_assigned_role := 'admin';
  ELSE
    v_assigned_role := COALESCE(NEW.raw_user_meta_data->>'role', 'solicitante');
    IF v_assigned_role NOT IN ('admin', 'solicitante') THEN
      v_assigned_role := 'solicitante';
    END IF;
  END IF;

  -- Extract full_name from user_metadata
  v_full_name := COALESCE(
    NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
    split_part(NEW.email, '@', 1),
    'Administrador'
  );

  -- Upsert profile
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
    role = CASE WHEN profiles.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END,
    full_name = CASE WHEN profiles.full_name = '' THEN EXCLUDED.full_name ELSE profiles.full_name END,
    updated_at = NOW();

  -- If this user is admin, claim all orphan trips
  IF v_assigned_role = 'admin' THEN
    PERFORM public.claim_orphan_trips(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. RPC to ensure profile exists for the caller (fallback if trigger lagged or user predates trigger)
-- If current user has no profile, creates one. If they're the first user or email matches, makes them admin.
-- Then auto-claims orphan trips.
CREATE OR REPLACE FUNCTION public.ensure_my_profile()
RETURNS JSONB AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_record RECORD;
  v_profile RECORD;
  v_admin_count INT;
  v_role TEXT := 'solicitante';
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  -- Check if profile already exists
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;

  IF v_profile.id IS NOT NULL THEN
    -- If user is admin, claim any orphan trips now
    IF v_profile.role = 'admin' THEN
      PERFORM public.claim_orphan_trips(v_uid);
    END IF;
    RETURN to_jsonb(v_profile);
  END IF;

  -- Profile does NOT exist: read from auth.users
  SELECT * INTO v_user_record FROM auth.users WHERE id = v_uid;

  SELECT COUNT(*) INTO v_admin_count FROM public.profiles WHERE role = 'admin' AND is_active = true;

  IF v_admin_count = 0 OR LOWER(COALESCE(v_user_record.email, '')) = 'luiz@globexmultimodal.com.br' THEN
    v_role := 'admin';
  ELSE
    v_role := COALESCE(v_user_record.raw_user_meta_data->>'role', 'solicitante');
    IF v_role NOT IN ('admin', 'solicitante') THEN
      v_role := 'solicitante';
    END IF;
  END IF;

  v_name := COALESCE(
    NULLIF(TRIM(v_user_record.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(v_user_record.raw_user_meta_data->>'name'), ''),
    split_part(v_user_record.email, '@', 1),
    'Usuário'
  );

  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (v_uid, COALESCE(v_user_record.email, ''), v_name, v_role, true, NOW(), NOW())
  RETURNING * INTO v_profile;

  IF v_role = 'admin' THEN
    PERFORM public.claim_orphan_trips(v_uid);
  END IF;

  RETURN to_jsonb(v_profile);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Create or fix Seed Admin user (luiz@globexmultimodal.com.br)
-- Per integration instructions: seed initial user luiz@globexmultimodal.com.br into auth.users and profiles
DO $$
DECLARE
  v_seed_user_id UUID;
BEGIN
  -- Check if user already exists in auth.users
  SELECT id INTO v_seed_user_id FROM auth.users WHERE LOWER(email) = 'luiz@globexmultimodal.com.br' LIMIT 1;

  IF v_seed_user_id IS NULL THEN
    v_seed_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      role,
      aud,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      phone,
      phone_change,
      phone_change_token,
      reauthentication_token
    ) VALUES (
      v_seed_user_id,
      '00000000-0000-0000-0000-000000000000',
      'luiz@globexmultimodal.com.br',
      crypt('Skip@Pass123', gen_salt('bf')),
      NOW(),
      NOW(),
      NOW(),
      '{"provider": "email", "providers": ["email"]}',
      '{"full_name": "Luiz Fernando", "name": "Luiz Fernando", "role": "admin"}',
      false,
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      '',
      NULL,
      '',
      '',
      ''
    );
  END IF;

  -- Ensure profile exists and is admin
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (
    v_seed_user_id,
    'luiz@globexmultimodal.com.br',
    'Luiz Fernando',
    'admin',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    is_active = true,
    email = EXCLUDED.email,
    full_name = CASE WHEN profiles.full_name = '' THEN EXCLUDED.full_name ELSE profiles.full_name END;

  -- Also make sure ANY existing profile for luiz is admin
  UPDATE public.profiles
  SET role = 'admin', is_active = true
  WHERE LOWER(email) = 'luiz@globexmultimodal.com.br';

  -- If there are still NO admins in public.profiles, promote the oldest profile to admin
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND is_active = true) THEN
    UPDATE public.profiles
    SET role = 'admin'
    WHERE id = (SELECT id FROM public.profiles ORDER BY created_at ASC LIMIT 1);
  END IF;

  -- Assign any unassigned / orphan trips (user_id IS NULL) to the admin
  PERFORM public.claim_orphan_trips(v_seed_user_id);
END $$;

-- 6. REVISE RLS POLICIES
-- Ensure that:
-- a) Authenticated users can read their own profile OR any profile if they are admin OR read profiles for trips display
-- b) An admin sees ALL trips (including any with user_id NULL)
-- c) Even if a trip has user_id IS NULL, any authenticated user can read it until claimed, or admin sees it
-- d) Expenses & audit_rules_log are visible to admins and trip owners, and also if trip has user_id IS NULL

-- PROFILES
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    -- Any authenticated user can read profiles (needed for table joins displaying collaborator names)
    true
  );

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid() OR public.is_admin(auth.uid())
  )
  WITH CHECK (
    public.is_admin(auth.uid()) OR (
      id = auth.uid() AND
      role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()) AND
      is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.uid() OR public.is_admin(auth.uid())
  );

-- TRIPS
DROP POLICY IF EXISTS "trips_select_policy" ON public.trips;
CREATE POLICY "trips_select_policy" ON public.trips
  FOR SELECT TO authenticated
  USING (
    -- Admin sees everything
    public.is_admin(auth.uid())
    -- User sees their own trips
    OR user_id = auth.uid()
    -- Orphan trips are visible to everyone so they never vanish before being claimed
    OR user_id IS NULL
  );

DROP POLICY IF EXISTS "trips_insert_policy" ON public.trips;
CREATE POLICY "trips_insert_policy" ON public.trips
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR user_id IS NULL
  );

DROP POLICY IF EXISTS "trips_update_policy" ON public.trips;
CREATE POLICY "trips_update_policy" ON public.trips
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR user_id IS NULL
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
    OR user_id IS NULL
  );

DROP POLICY IF EXISTS "trips_delete_policy" ON public.trips;
CREATE POLICY "trips_delete_policy" ON public.trips
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  );

-- EXPENSES
DROP POLICY IF EXISTS "expenses_select_policy" ON public.expenses;
CREATE POLICY "expenses_select_policy" ON public.expenses
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "expenses_insert_policy" ON public.expenses;
CREATE POLICY "expenses_insert_policy" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "expenses_update_policy" ON public.expenses;
CREATE POLICY "expenses_update_policy" ON public.expenses
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "expenses_delete_policy" ON public.expenses;
CREATE POLICY "expenses_delete_policy" ON public.expenses
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR trip_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = expenses.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

-- AUDIT RULES LOG
DROP POLICY IF EXISTS "audit_rules_log_select_policy" ON public.audit_rules_log;
CREATE POLICY "audit_rules_log_select_policy" ON public.audit_rules_log
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "audit_rules_log_insert_policy" ON public.audit_rules_log;
CREATE POLICY "audit_rules_log_insert_policy" ON public.audit_rules_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "audit_rules_log_update_policy" ON public.audit_rules_log;
CREATE POLICY "audit_rules_log_update_policy" ON public.audit_rules_log
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "audit_rules_log_delete_policy" ON public.audit_rules_log;
CREATE POLICY "audit_rules_log_delete_policy" ON public.audit_rules_log
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = audit_rules_log.trip_id
        AND (t.user_id = auth.uid() OR t.user_id IS NULL OR public.is_admin(auth.uid()))
    )
  );
