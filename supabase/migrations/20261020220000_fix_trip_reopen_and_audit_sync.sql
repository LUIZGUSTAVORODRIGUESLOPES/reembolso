-- Migration: Fix trip reopen status sync and prevent auto-promotion when trip is reopened
-- Quando uma viagem foi reaberta (reopened_at IS NOT NULL e reopened_at >= report_sent_at ou report_sent_at IS NULL),
-- o usuário reabriu a viagem deliberadamente para 'em_triagem' a fim de corrigir comprovantes, classificações ou despesas.
-- A função sync_trip_audit_status NÃO deve auto-promover imediatamente a viagem de volta para 'auditada'
-- enquanto a viagem estiver reaberta, pois o status 'auditada' bloqueia a edição fiscal das despesas
-- (categoria, valor, etc.) no trigger check_expense_update_allowed e trava botões na interface.
-- Além disso, viagens reabertas (ou abertas) devem permitir edição e classificação de suas despesas.

-- 1. Atualizar sync_trip_audit_status para respeitar reabertura
CREATE OR REPLACE FUNCTION public.sync_trip_audit_status(p_trip_id uuid)
RETURNS void AS $$
DECLARE
  v_current_status TEXT;
  v_report_sent_at TIMESTAMPTZ;
  v_reopened_at TIMESTAMPTZ;
  v_is_reopened BOOLEAN;
  v_total_expenses INT;
  v_checked_expenses INT;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN;
  END IF;

  -- Obter status e dados de reabertura da viagem
  SELECT status, report_sent_at, reopened_at
  INTO v_current_status, v_report_sent_at, v_reopened_at
  FROM public.trips
  WHERE id = p_trip_id;

  -- Atua SOMENTE em viagens com status 'em_triagem' ou 'auditada'
  -- Jamais toca 'com_pendencias', 'fechada', 'reembolsada'
  IF v_current_status NOT IN ('em_triagem', 'auditada') THEN
    RETURN;
  END IF;

  -- Verificar se é uma viagem reaberta sob correção ativa
  v_is_reopened := (v_reopened_at IS NOT NULL) AND (v_report_sent_at IS NULL OR v_reopened_at >= v_report_sent_at);

  -- Se a viagem está reaberta e em 'em_triagem', NÃO auto-promove para 'auditada'
  -- (pois 'auditada' bloqueia a reclassificação de recibos e dados fiscais).
  -- A promoção para fechada ocorrerá apenas quando o relatório for reenviado.
  IF v_is_reopened AND v_current_status = 'em_triagem' THEN
    RETURN;
  END IF;

  -- Contar despesas totais e conferidas da viagem
  SELECT
    count(*),
    count(*) FILTER (WHERE audit_manual_checked = true)
  INTO v_total_expenses, v_checked_expenses
  FROM public.expenses
  WHERE trip_id = p_trip_id;

  -- Se tem despesas (> 0) e 100% estão conferidas
  IF v_total_expenses > 0 AND v_total_expenses = v_checked_expenses THEN
    IF v_current_status = 'em_triagem' AND NOT v_is_reopened THEN
      UPDATE public.trips
      SET status = 'auditada'
      WHERE id = p_trip_id AND status = 'em_triagem';
    END IF;
  ELSE
    -- Se não estiver 100% conferida (ou não tiver despesas), e estava 'auditada', regride para 'em_triagem'
    IF v_current_status = 'auditada' THEN
      UPDATE public.trips
      SET status = 'em_triagem'
      WHERE id = p_trip_id AND status = 'auditada';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

-- 2. Garantir publicação de trips em realtime se ainda não estiver publicada
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'trips'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
  END IF;
END $$;
