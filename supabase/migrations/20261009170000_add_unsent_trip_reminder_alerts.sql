-- Migration: Add unsent trip reminder alert configuration to profiles and create reminder dispatch log
-- File: supabase/migrations/20261009170000_add_unsent_trip_reminder_alerts.sql

-- 1. Add alert configuration columns to public.profiles (additive only)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alert_unsent_trip_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_unsent_trip_days integer NOT NULL DEFAULT 5;

-- Constrain days to positive sensible range (e.g., 1 to 90 days)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_alert_unsent_trip_days_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_alert_unsent_trip_days_check
      CHECK (alert_unsent_trip_days >= 1 AND alert_unsent_trip_days <= 90);
  END IF;
END $$;

-- 2. Create log table for reminder emails sent (prevents spam / repeated daily dispatches for the same trip)
CREATE TABLE IF NOT EXISTS public.trip_reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  days_after_end integer NOT NULL DEFAULT 5,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'sent',
  message_id text,
  error_message text,
  CONSTRAINT trip_reminder_logs_trip_user_unique UNIQUE (trip_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_reminder_logs_trip_id ON public.trip_reminder_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_reminder_logs_user_id ON public.trip_reminder_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_reminder_logs_sent_at ON public.trip_reminder_logs(sent_at);

-- 3. Enable RLS on public.trip_reminder_logs
ALTER TABLE public.trip_reminder_logs ENABLE ROW LEVEL SECURITY;

-- Policies for trip_reminder_logs:
-- Authenticated users can view reminder logs for their own user_id OR admins can view all
DROP POLICY IF EXISTS "trip_reminder_logs_select_policy" ON public.trip_reminder_logs;
CREATE POLICY "trip_reminder_logs_select_policy" ON public.trip_reminder_logs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "trip_reminder_logs_insert_policy" ON public.trip_reminder_logs;
CREATE POLICY "trip_reminder_logs_insert_policy" ON public.trip_reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "trip_reminder_logs_update_policy" ON public.trip_reminder_logs;
CREATE POLICY "trip_reminder_logs_update_policy" ON public.trip_reminder_logs
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "trip_reminder_logs_delete_policy" ON public.trip_reminder_logs;
CREATE POLICY "trip_reminder_logs_delete_policy" ON public.trip_reminder_logs
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
  );

-- 4. Update profiles_update_policy to allow users to update their own alert preferences
-- (Preserves previous security: admins update any profile; users update own profile fields)
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
