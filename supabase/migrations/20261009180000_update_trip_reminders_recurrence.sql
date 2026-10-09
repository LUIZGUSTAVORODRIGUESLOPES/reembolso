-- Migration: 20261009180000_update_trip_reminders_recurrence.sql
-- Objetivo:
-- 1. Adicionar coluna `alert_unsent_trip_repeat_days` na tabela `profiles` (default 7, intervalo 1 a 90)
-- 2. Remover a constraint UNIQUE (trip_id, user_id) de `trip_reminder_logs` para permitir histórico de reenvios recorrentes
-- 3. Adicionar colunas aditivas `reminder_sequence` (1 para primeiro alerta, 2+ para reenvios) e `is_recurrence` (boolean) em `trip_reminder_logs`
-- 4. Criar índice composto (trip_id, user_id, sent_at DESC) para consultas ultrarrápidas do último lembrete por viagem
-- 5. Preservar rigorosamente todos os dados existentes (política de migração aditiva sem perda de dados)

-- 1. Campo de intervalo de repetição em profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alert_unsent_trip_repeat_days INTEGER NOT NULL DEFAULT 7;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_alert_unsent_trip_repeat_days_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_alert_unsent_trip_repeat_days_check
      CHECK (alert_unsent_trip_repeat_days >= 1 AND alert_unsent_trip_repeat_days <= 90);
  END IF;
END $$;

-- 2. Permitir múltiplos registros por viagem em trip_reminder_logs
-- Removendo apenas a UNIQUE constraint que bloqueava o reenvio periódico
ALTER TABLE public.trip_reminder_logs
  DROP CONSTRAINT IF EXISTS trip_reminder_logs_trip_user_unique;

-- 3. Colunas informativas adicionais em trip_reminder_logs
ALTER TABLE public.trip_reminder_logs
  ADD COLUMN IF NOT EXISTS reminder_sequence INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_recurrence BOOLEAN NOT NULL DEFAULT false;

-- 4. Índice para busca performática do último lembrete de cada viagem/usuário
CREATE INDEX IF NOT EXISTS idx_trip_reminder_logs_trip_user_sent
  ON public.trip_reminder_logs (trip_id, user_id, sent_at DESC);
