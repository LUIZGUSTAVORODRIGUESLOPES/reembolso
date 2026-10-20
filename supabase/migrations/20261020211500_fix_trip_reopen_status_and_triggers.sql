-- Migration: Correção da governança de reabertura de viagens e solicitações avulsas
-- Impede que triggers de auto-promoção revertam o status de viagens reabertas para 'fechada' / 'empacotada'.
-- Garante que viagens reabertas para 'em_triagem' permaneçam desbloqueadas para inclusão, edição e correção de comprovantes.

-- 1. Atualizar função de auto-promoção de viagens ao enviar relatório
CREATE OR REPLACE FUNCTION public.auto_promote_trip_status_on_report_sent()
RETURNS trigger AS $$
DECLARE
  v_is_reopen BOOLEAN;
BEGIN
  -- Identifica se é um fluxo de reabertura controlada de auditada ou fechada para em_triagem
  v_is_reopen := (OLD.status IN ('auditada', 'fechada') AND NEW.status = 'em_triagem');

  -- Em reabertura de viagem, NUNCA promove de volta para 'fechada'
  IF v_is_reopen THEN
    RETURN NEW;
  END IF;

  -- Se a viagem já está em 'em_triagem' (reaberta) e report_sent_at não mudou nesta transação,
  -- preserva 'em_triagem' (o usuário está ativamente corrigindo os comprovantes)
  IF OLD.status = 'em_triagem' AND (OLD.report_sent_at IS NOT DISTINCT FROM NEW.report_sent_at) THEN
    RETURN NEW;
  END IF;

  -- A promoção automática para 'fechada' ocorre SOMENTE quando o relatório foi enviado ou reenviado
  -- (NEW.report_sent_at preenchido e alterado nesta atualização) e a viagem não está reembolsada
  IF NEW.report_sent_at IS NOT NULL
     AND (OLD.report_sent_at IS DISTINCT FROM NEW.report_sent_at)
     AND OLD.status <> 'reembolsada' THEN
    -- Valida que todas as despesas estejam 100% conferidas
    PERFORM public.check_trip_gatekeeping_allowed(NEW.id);

    -- Promove para 'fechada' se status for em_triagem, com_pendencias, auditada ou NULL
    IF NEW.status IS NULL OR NEW.status IN ('em_triagem', 'com_pendencias', 'auditada') THEN
      NEW.status := 'fechada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Atualizar função de auto-promoção de solicitações avulsas
CREATE OR REPLACE FUNCTION public.auto_promote_standalone_request_status_on_report_sent()
RETURNS trigger AS $$
DECLARE
  v_is_reopen BOOLEAN;
BEGIN
  v_is_reopen := (OLD.status = 'empacotada' AND NEW.status = 'em_triagem');
  IF v_is_reopen THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'em_triagem' AND (OLD.report_sent_at IS NOT DISTINCT FROM NEW.report_sent_at) THEN
    RETURN NEW;
  END IF;

  IF NEW.report_sent_at IS NOT NULL
     AND (OLD.report_sent_at IS DISTINCT FROM NEW.report_sent_at)
     AND OLD.status <> 'quitada' THEN
    IF NEW.status IS NULL OR NEW.status = 'em_triagem' THEN
      NEW.status := 'empacotada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Atualizar check_trip_update_allowed para permitir correções de datas/destino em viagens reabertas ('em_triagem')
CREATE OR REPLACE FUNCTION public.check_trip_update_allowed()
RETURNS trigger AS $$
DECLARE
  v_is_reopen BOOLEAN;
  v_is_trip_locked BOOLEAN;
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

  -- 5. Proteção de campos cadastrais principais (destination, start_date, end_date, transport_type):
  -- Bloqueio estrito se a viagem estiver 'fechada' ou 'reembolsada', OU se estiver 'auditada' com relatório já enviado.
  -- Viagens abertas ('em_triagem') e reabertas permitem edição de período e destino.
  v_is_trip_locked := (OLD.status IN ('fechada', 'reembolsada'))
                   OR (OLD.status NOT IN ('em_triagem') AND OLD.report_sent_at IS NOT NULL);

  IF v_is_trip_locked AND NOT v_is_reopen THEN
    IF (OLD.destination IS DISTINCT FROM NEW.destination) OR
       (OLD.start_date IS DISTINCT FROM NEW.start_date) OR
       (OLD.end_date IS DISTINCT FROM NEW.end_date) OR
       (OLD.transport_type IS DISTINCT FROM NEW.transport_type) THEN
      RAISE EXCEPTION 'Não é permitido modificar os campos principais (destino, datas ou tipo de transporte) de uma viagem fechada ou com relatório já enviado (status: "%"). Para correções, solicite a reabertura por um administrador.', OLD.status
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Restaurar viagens que já haviam sido reabertas via governança mas foram travadas pelo trigger antigo
UPDATE public.trips
SET status = 'em_triagem'
WHERE reopened_at IS NOT NULL
  AND status = 'fechada'
  AND (report_sent_at IS NULL OR reopened_at >= report_sent_at);
