-- Migration: Automação de status de viagens (promoção em_triagem -> auditada e regressão auditada -> em_triagem)
-- Promoção: quando 100% das despesas da viagem tiverem audit_manual_checked = true (e total despesas > 0), promove 'em_triagem' -> 'auditada'
-- Regressão: se desmarcar uma despesa ou adicionar despesa não conferida ou mover/deletar e não estiver mais 100%, rebaixa 'auditada' -> 'em_triagem'
-- SOMENTE atua em viagens com status 'em_triagem' ou 'auditada'. JAMAIS toca 'com_pendencias', 'fechada', 'reembolsada'.
-- Além disso, atualiza check_expense_update_allowed para permitir marcar/desmarcar audit_manual_checked mesmo se a viagem estiver 'auditada' (necessário para possibilitar a regressão).

-- 1. Atualizar check_expense_update_allowed para permitir atualização dos campos de conferência manual em viagens auditadas
CREATE OR REPLACE FUNCTION public.check_expense_update_allowed()
RETURNS trigger AS $$
DECLARE
  v_old_trip_status TEXT;
  v_new_trip_status TEXT;
  v_is_manual_audit_toggle_only BOOLEAN;
BEGIN
  -- Se a despesa pertencia a uma viagem fechada ou reembolsada, bloqueio total absoluto
  IF OLD.trip_id IS NOT NULL THEN
    SELECT status INTO v_old_trip_status
    FROM public.trips
    WHERE id = OLD.trip_id;

    IF v_old_trip_status IN ('fechada', 'reembolsada') THEN
      RAISE EXCEPTION 'Não é permitido modificar despesas de uma viagem com status "%" (fechada ou reembolsada).', v_old_trip_status
        USING ERRCODE = '23505';
    END IF;

    -- Se a viagem estiver 'auditada':
    -- Permitir estritamente atualizar campos de conferência manual (audit_manual_checked, audit_manual_checked_at, audit_manual_checked_by_id, audit_manual_checked_by_name, audit_status, is_verified)
    -- Isso é fundamental para permitir que o auditor desfaça um OK (regressão auditada -> em_triagem).
    IF v_old_trip_status = 'auditada' THEN
      v_is_manual_audit_toggle_only :=
        (OLD.trip_id IS NOT DISTINCT FROM NEW.trip_id) AND
        (OLD.file_url IS NOT DISTINCT FROM NEW.file_url) AND
        (OLD.file_name IS NOT DISTINCT FROM NEW.file_name) AND
        (OLD.issue_date IS NOT DISTINCT FROM NEW.issue_date) AND
        (OLD.issue_time IS NOT DISTINCT FROM NEW.issue_time) AND
        (OLD.category IS NOT DISTINCT FROM NEW.category) AND
        (OLD.merchant_name IS NOT DISTINCT FROM NEW.merchant_name) AND
        (OLD.amount IS NOT DISTINCT FROM NEW.amount) AND
        (OLD.ocr_raw_text IS NOT DISTINCT FROM NEW.ocr_raw_text) AND
        (OLD.cnpj IS NOT DISTINCT FROM NEW.cnpj);

      IF NOT v_is_manual_audit_toggle_only THEN
        RAISE EXCEPTION 'Não é permitido modificar dados fiscais ou mover despesas de uma viagem com status "auditada". Apenas a conferência de auditoria pode ser alterada.'
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  -- Se foi reatribuída para outra viagem, verificar se o destino está auditado/fechado/reembolsado
  IF NEW.trip_id IS NOT NULL AND (OLD.trip_id IS DISTINCT FROM NEW.trip_id) THEN
    SELECT status INTO v_new_trip_status
    FROM public.trips
    WHERE id = NEW.trip_id;

    IF v_new_trip_status IN ('auditada', 'fechada', 'reembolsada') THEN
      RAISE EXCEPTION 'Não é permitido mover despesas para uma viagem com status "%" (auditada, fechada ou reembolsada).', v_new_trip_status
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Função para sincronizar o status da viagem com base na conferência manual das suas despesas
CREATE OR REPLACE FUNCTION public.sync_trip_audit_status(p_trip_id uuid)
RETURNS void AS $$
DECLARE
  v_current_status TEXT;
  v_total_expenses INT;
  v_checked_expenses INT;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN;
  END IF;

  -- Obter status atual da viagem
  SELECT status INTO v_current_status
  FROM public.trips
  WHERE id = p_trip_id;

  -- Atua SOMENTE em viagens com status 'em_triagem' ou 'auditada'
  -- Jamais toca 'com_pendencias', 'fechada', 'reembolsada'
  IF v_current_status NOT IN ('em_triagem', 'auditada') THEN
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
    IF v_current_status = 'em_triagem' THEN
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

-- 3. Trigger na tabela expenses para invocar sync_trip_audit_status
CREATE OR REPLACE FUNCTION public.trigger_sync_trip_audit_status()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.trip_id IS NOT NULL THEN
      PERFORM public.sync_trip_audit_status(OLD.trip_id);
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.trip_id IS DISTINCT FROM NEW.trip_id THEN
      IF OLD.trip_id IS NOT NULL THEN
        PERFORM public.sync_trip_audit_status(OLD.trip_id);
      END IF;
      IF NEW.trip_id IS NOT NULL THEN
        PERFORM public.sync_trip_audit_status(NEW.trip_id);
      END IF;
    ELSE
      -- Mesma viagem: recalcula se audit_manual_checked mudou
      IF OLD.audit_manual_checked IS DISTINCT FROM NEW.audit_manual_checked THEN
        IF NEW.trip_id IS NOT NULL THEN
          PERFORM public.sync_trip_audit_status(NEW.trip_id);
        END IF;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.trip_id IS NOT NULL THEN
      PERFORM public.sync_trip_audit_status(NEW.trip_id);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

DROP TRIGGER IF EXISTS trg_sync_trip_audit_status ON public.expenses;
CREATE TRIGGER trg_sync_trip_audit_status
  AFTER INSERT OR UPDATE OF trip_id, audit_manual_checked OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_trip_audit_status();

-- 4. Backfill / Sincronização inicial para viagens existentes em_triagem / auditada
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT id FROM public.trips WHERE status IN ('em_triagem', 'auditada')
  ) LOOP
    PERFORM public.sync_trip_audit_status(r.id);
  END LOOP;
END $$;
