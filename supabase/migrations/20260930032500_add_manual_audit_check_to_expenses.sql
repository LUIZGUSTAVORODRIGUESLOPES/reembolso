-- Migration: Adicionar campos de conferência manual de auditoria para despesas
-- Data: 2026-09-30

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS audit_manual_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_manual_checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS audit_manual_checked_by_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audit_manual_checked_by_name text NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_audit_manual_checked
  ON public.expenses(audit_manual_checked);
