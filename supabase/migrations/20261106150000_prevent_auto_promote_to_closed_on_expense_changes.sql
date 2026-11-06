-- Migration: 20261106150000_prevent_auto_promote_to_closed_on_expense_changes.sql
-- Objetivo: Impedir avanço automático indevido do status de viagens para 'fechada' ou 'auditada'
-- ao inserir, atualizar ou conferir comprovantes (despesas).
-- Regras de Negócio:
-- 1. A inserção/atualização/conferência de despesas NUNCA altera o status da viagem para 'fechada' nem 'auditada'.
-- 2. O trigger de auto-promoção ao enviar relatório (auto_promote_trip_status_on_report_sent)
--    somente atua quando report_sent_at for explicitamente alterado/preenchido nesta transação.
--    Em recálculo de total_amount, edição de período ou outras alterações de viagem, o status NÃO é alterado.
-- 3. Em viagens reabertas (reopened_at recente ou em_triagem), o status NUNCA avança sozinho para 'fechada'.
-- 4. As únicas transições automáticas para 'fechada' / 'reembolsada' devem ocorrer por ação explícita
--    do usuário: envio de relatório (markReportEmailSent) e quitação (settlement).

-- 1. Recriação de auto_promote_trip_status_on_report_sent
CREATE OR REPLACE FUNCTION public.auto_promote_trip_status_on_report_sent()
RETURNS trigger AS $$
DECLARE
  v_is_reopen BOOLEAN;
BEGIN
  -- Se for um fluxo explícito de reabertura para 'em_triagem', preserva 'em_triagem'
  v_is_reopen := (OLD.status IN ('auditada', 'fechada') AND NEW.status = 'em_triagem');
  IF v_is_reopen THEN
    RETURN NEW;
  END IF;

  -- Se report_sent_at NÃO mudou nesta transação (ex: recálculo de total_amount disparado
  -- por insert/update/delete de despesas, edição de datas, etc.), NUNCA altera o status!
  IF OLD.report_sent_at IS NOT DISTINCT FROM NEW.report_sent_at THEN
    RETURN NEW;
  END IF;

  -- Se a viagem está reaberta (reopened_at preenchido e não superado por novo envio explícito),
  -- preserva o status atual
  IF OLD.reopened_at IS NOT NULL AND (NEW.report_sent_at IS NULL OR OLD.reopened_at >= NEW.report_sent_at) THEN
    RETURN NEW;
  END IF;

  -- A promoção automática para 'fechada' ocorre ESTRITAMENTE quando o envio de relatório
  -- foi executado nesta atualização (NEW.report_sent_at foi preenchido/alterado) e a viagem não está reembolsada
  IF NEW.report_sent_at IS NOT NULL
     AND (OLD.report_sent_at IS NULL OR NEW.report_sent_at IS DISTINCT FROM OLD.report_sent_at)
     AND OLD.status <> 'reembolsada' THEN
    -- Valida que todas as despesas estejam 100% conferidas via gatekeeping
    PERFORM public.check_trip_gatekeeping_allowed(NEW.id);

    -- Promove para 'fechada' se status for em_triagem, com_pendencias, auditada ou NULL
    IF NEW.status IS NULL OR NEW.status IN ('em_triagem', 'com_pendencias', 'auditada') THEN
      NEW.status := 'fechada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Recriação de sync_trip_audit_status
-- Não promove mais viagens de 'em_triagem' para 'auditada' ou 'fechada' na inserção/conferência de despesas.
-- A viagem permanece sob controle do usuário em 'em_triagem' até que ele decida enviar o relatório ou fechá-la.
CREATE OR REPLACE FUNCTION public.sync_trip_audit_status(p_trip_id uuid)
RETURNS void AS $$
BEGIN
  -- No-op: NUNCA auto-promove status de viagem por inserção ou edição de despesa.
  -- O progresso de conferência é derivado dinamicamente no frontend e o gatekeeping
  -- valida a integridade estrita no envio do relatório.
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

-- 3. Desativar trigger trg_sync_trip_audit_status na tabela expenses para evitar overhead
DROP TRIGGER IF EXISTS trg_sync_trip_audit_status ON public.expenses;

-- 4. Restaurar viagens que possam ter sido reabertas mas voltaram indevidamente para 'fechada' ou 'auditada'
UPDATE public.trips
SET status = 'em_triagem'
WHERE reopened_at IS NOT NULL
  AND status IN ('fechada', 'auditada')
  AND (report_sent_at IS NULL OR reopened_at >= report_sent_at);
