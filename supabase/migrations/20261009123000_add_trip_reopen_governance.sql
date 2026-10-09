-- Migration: Adicionar campos de reabertura de viagem e atualizar trigger de governança
-- Puramente aditiva: preserva todos os dados existentes e regras de integridade.

-- 1. Novos campos para governança de reabertura de viagem
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reopened_by_name TEXT,
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

-- 2. Índice para consultas de viagens reabertas
CREATE INDEX IF NOT EXISTS idx_trips_reopened_at ON public.trips(reopened_at);

-- 3. Atualizar função de proteção de viagem (check_trip_update_allowed)
-- Regras de governança:
-- a) Viagens 'reembolsada' (já quitadas definitivamente) NUNCA podem ter status retrocedido ou alterado.
-- b) Transições de reabertura permitidas única e especificamente:
--    'auditada' -> 'em_triagem' ou 'fechada' -> 'em_triagem'.
--    Nesse caso, a reabertura destrava a viagem para novas correções.
-- c) Quando OLD.status IN ('auditada', 'fechada', 'reembolsada') e NÃO é um fluxo de reabertura para 'em_triagem',
--    os campos principais (destination, start_date, end_date, transport_type) continuam estritamente bloqueados.
-- d) Atualizações de status para trás que NÃO sejam a reabertura permitida ('auditada'/'fechada' -> 'em_triagem') continuam bloqueadas.
-- e) Atualização dos dados de envio de relatório (report_sent_at, report_sent_to, report_sent_by_id, report_sent_by_name)
--    continua 100% permitida mesmo em viagens auditadas/fechadas (primeiro envio ou reenvio).
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

  -- 2. Se a viagem estava fechada, não pode retroceder para status intermediários (ex: auditada, com_pendencias),
  -- apenas pode ser reaberta para 'em_triagem' ou avançar para 'reembolsada'
  IF OLD.status = 'fechada' AND NOT v_is_reopen THEN
    IF NEW.status IN ('auditada', 'com_pendencias') THEN
      RAISE EXCEPTION 'Viagens com status "fechada" só podem ser reabertas para o status "em_triagem" mediante governança com justificativa.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 3. Se a viagem estava auditada, não pode retroceder para 'com_pendencias'
  IF OLD.status = 'auditada' AND NOT v_is_reopen THEN
    IF NEW.status = 'com_pendencias' THEN
      RAISE EXCEPTION 'Viagens com status "auditada" só podem ser reabertas para o status "em_triagem" mediante governança com justificativa.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 4. Se já estava em status auditada, fechada ou reembolsada, campos principais permanecem protegidos,
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
