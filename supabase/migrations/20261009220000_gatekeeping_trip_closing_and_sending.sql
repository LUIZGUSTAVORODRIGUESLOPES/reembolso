-- 20261009220000_gatekeeping_trip_closing_and_sending.sql
-- Camada de Proteção de Backend (Gatekeeping):
-- Impede estritamente que viagens com comprovantes pendentes (não conferidos 100%)
-- sejam fechadas ou quitadas no banco de dados.
--
-- Regras de Negócio:
-- 1. Uma viagem só pode avançar para 'fechada' ou 'reembolsada' se possuir ao menos 1 despesa
--    e 100% de suas despesas vinculadas estiverem conferidas (audit_manual_checked = true).
-- 2. Se houver despesas com audit_manual_checked = false (ou audit_status = 'pendente'),
--    ou se a viagem não possuir despesas, o avanço para 'fechada' ou 'reembolsada' é abortado
--    com exceção explícita em pt-BR.
-- 3. A auto-promoção ao enviar relatório por e-mail (auto_promote_trip_status_on_report_sent)
--    também valida se todas as despesas estão conferidas antes de promover para 'fechada'.

CREATE OR REPLACE FUNCTION public.check_trip_gatekeeping_allowed(p_trip_id uuid)
RETURNS void AS $$
DECLARE
  v_total_expenses INT;
  v_checked_expenses INT;
  v_pending_count INT;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE audit_manual_checked = true),
    count(*) FILTER (WHERE audit_manual_checked = false OR audit_status = 'pendente' OR is_verified = false)
  INTO v_total_expenses, v_checked_expenses, v_pending_count
  FROM public.expenses
  WHERE trip_id = p_trip_id;

  IF v_total_expenses = 0 THEN
    RAISE EXCEPTION 'Não é permitido fechar ou quitar uma viagem sem comprovantes vinculados. Complete a inclusão e conferência na Triagem.'
      USING ERRCODE = '23505';
  END IF;

  IF v_pending_count > 0 OR v_checked_expenses < v_total_expenses THEN
    RAISE EXCEPTION 'Não é permitido fechar, enviar ou quitar uma viagem com comprovantes pendentes. Complete a conferência de todos os recibos pendentes na Triagem para liberar o envio (% de % conferidos).', v_checked_expenses, v_total_expenses
      USING ERRCODE = '23505';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

-- 1. Atualizar check_trip_update_allowed para aplicar o gatekeeping ao avançar para 'fechada' ou 'reembolsada'
CREATE OR REPLACE FUNCTION public.check_trip_update_allowed()
RETURNS trigger AS $$
DECLARE
  v_is_reopen BOOLEAN;
BEGIN
  -- Verificar se é um fluxo de reabertura controlada de auditada ou fechada para em_triagem
  v_is_reopen := (OLD.status IN ('auditada', 'fechada') AND NEW.status = 'em_triagem');

  -- 1. Se a viagem JÁ estava reembolsada (quitação concluída), é 100% definitiva e imutável
  IF OLD.status = 'reembolsada' THEN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
      RAISE EXCEPTION 'Não é permitido alterar o status de uma viagem já reembolsada e quitada. A quitação é definitiva.'
        USING ERRCODE = '23505';
    END IF;

    IF (OLD.settlement_date IS DISTINCT FROM NEW.settlement_date) OR
       (OLD.settlement_amount IS DISTINCT FROM NEW.settlement_amount) OR
       (OLD.settlement_batch_id IS DISTINCT FROM NEW.settlement_batch_id) THEN
      RAISE EXCEPTION 'A quitação de uma viagem reembolsada é definitiva e não pode ser alterada.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 2. Gatekeeping: Se estiver transicionando para 'fechada' ou 'reembolsada' a partir de outro status
  -- (ou preenchendo report_sent_at / settlement_date), exige 100% de conferência dos recibos
  IF (NEW.status IN ('fechada', 'reembolsada') AND OLD.status NOT IN ('fechada', 'reembolsada'))
     OR (NEW.settlement_date IS NOT NULL AND OLD.settlement_date IS NULL) THEN
    PERFORM public.check_trip_gatekeeping_allowed(NEW.id);
  END IF;

  -- 3. Se a viagem estava fechada, não pode retroceder para status intermediários (ex: auditada, com_pendencias),
  -- apenas pode ser reaberta para 'em_triagem' ou avançar para 'reembolsada'
  IF OLD.status = 'fechada' AND NOT v_is_reopen THEN
    IF NEW.status IN ('auditada', 'com_pendencias') THEN
      RAISE EXCEPTION 'Viagens com status "fechada" só podem ser reabertas para o status "em_triagem" mediante governança com justificativa.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 4. Se a viagem estava auditada, não pode retroceder para 'com_pendencias'
  IF OLD.status = 'auditada' AND NOT v_is_reopen THEN
    IF NEW.status = 'com_pendencias' THEN
      RAISE EXCEPTION 'Viagens com status "auditada" só podem ser reabertas para o status "em_triagem" mediante governança com justificativa.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 5. Se já estava em status auditada, fechada ou reembolsada, campos principais permanecem protegidos,
  -- A MENOS que esteja ocorrendo a transição de reabertura para 'em_triagem'
  IF OLD.status IN ('auditada', 'fechada', 'reembolsada') AND NOT v_is_reopen THEN
    IF (OLD.destination IS DISTINCT FROM NEW.destination) OR
       (OLD.start_date IS DISTINCT FROM NEW.start_date) OR
       (OLD.end_date IS DISTINCT FROM NEW.end_date) OR
       (OLD.transport_type IS DISTINCT FROM NEW.transport_type) THEN
      RAISE EXCEPTION 'Não é permitido modificar os campos principais (destino, datas ou tipo de transporte) de uma viagem com status "%" (auditada, fechada ou reembolsada).', OLD.status
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Atualizar auto_promote_trip_status_on_report_sent com validação de conferência
CREATE OR REPLACE FUNCTION public.auto_promote_trip_status_on_report_sent()
RETURNS trigger AS $$
BEGIN
  -- Se o relatório foi enviado (NEW.report_sent_at preenchido)
  -- e a viagem NÃO está/estava reembolsada
  IF NEW.report_sent_at IS NOT NULL AND (OLD.report_sent_at IS NULL OR OLD.status <> 'reembolsada') THEN
    -- Valida que todas as despesas estejam 100% conferidas
    PERFORM public.check_trip_gatekeeping_allowed(NEW.id);

    -- Se NEW.status for em_triagem, com_pendencias, auditada ou NULL
    -- promove para 'fechada'
    IF NEW.status IS NULL OR NEW.status IN ('em_triagem', 'com_pendencias', 'auditada') THEN
      NEW.status := 'fechada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
