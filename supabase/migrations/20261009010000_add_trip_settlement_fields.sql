-- Migration: Adicionar campos de quitação de viagem (reembolso) na tabela trips
-- Puramente aditiva: preserva todos os dados existentes e regras de governança.

-- 1. Novos campos para rastreamento de quitação e envio de relatório
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS report_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS report_sent_to TEXT,
  ADD COLUMN IF NOT EXISTS report_sent_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_sent_by_name TEXT,
  ADD COLUMN IF NOT EXISTS settlement_date DATE,
  ADD COLUMN IF NOT EXISTS settlement_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS settlement_deposit_total NUMERIC,
  ADD COLUMN IF NOT EXISTS settlement_batch_id UUID,
  ADD COLUMN IF NOT EXISTS settlement_batch_count INTEGER,
  ADD COLUMN IF NOT EXISTS settled_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS settled_by_name TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- 2. Índices de consulta eficientes
CREATE INDEX IF NOT EXISTS idx_trips_settlement_batch_id ON public.trips(settlement_batch_id);
CREATE INDEX IF NOT EXISTS idx_trips_settlement_date ON public.trips(settlement_date);

-- 3. Atualizar função de proteção de viagem (check_trip_update_allowed)
-- Garante que:
-- a) destination, start_date, end_date, transport_type continuam BLOQUEADOS se auditada/fechada/reembolsada.
-- b) Transições de status para 'fechada' ou 'reembolsada' e gravação de campos de quitação (settlement_*)
--    e campos de envio de relatório (report_sent_*) continuam 100% permitidas.
-- c) Quando uma viagem já está com status 'reembolsada', dados de quitação e campos principais permanecem imutáveis.
CREATE OR REPLACE FUNCTION public.check_trip_update_allowed()
RETURNS trigger AS $$
BEGIN
  -- Se já estava em status auditada, fechada ou reembolsada, campos principais permanecem protegidos
  IF OLD.status IN ('auditada', 'fechada', 'reembolsada') THEN
    IF (OLD.destination IS DISTINCT FROM NEW.destination) OR
       (OLD.start_date IS DISTINCT FROM NEW.start_date) OR
       (OLD.end_date IS DISTINCT FROM NEW.end_date) OR
       (OLD.transport_type IS DISTINCT FROM NEW.transport_type) THEN
      RAISE EXCEPTION 'Não é permitido modificar os campos principais (destino, datas ou tipo de transporte) de uma viagem com status "%" (auditada, fechada ou reembolsada).', OLD.status
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Se a viagem JÁ estava reembolsada (quitação concluída), ela não pode ter seu status retrocedido nem ter a quitação alterada
  IF OLD.status = 'reembolsada' THEN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
      RAISE EXCEPTION 'Não é permitido alterar o status de uma viagem já reembolsada e quitada.'
        USING ERRCODE = '23505';
    END IF;

    IF (OLD.settlement_date IS DISTINCT FROM NEW.settlement_date) OR
       (OLD.settlement_amount IS DISTINCT FROM NEW.settlement_amount) OR
       (OLD.settlement_batch_id IS DISTINCT FROM NEW.settlement_batch_id) THEN
      RAISE EXCEPTION 'A quitação de uma viagem reembolsada é definitiva e não pode ser alterada.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
