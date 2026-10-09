-- 20261009190000_auto_promote_status_on_report_sent.sql
-- Camada 1: Blindagem de integridade de status no envio de relatórios.
-- Promove automaticamente o status para 'fechada' (trips) ou 'empacotada' (standalone_requests)
-- quando report_sent_at for preenchido, nunca rebaixando status em reenvios.

-- 1. Função de trigger para public.trips
CREATE OR REPLACE FUNCTION public.auto_promote_trip_status_on_report_sent()
RETURNS trigger AS $$
BEGIN
  -- Se o relatório foi enviado (NEW.report_sent_at preenchido)
  -- e a viagem NÃO está/estava reembolsada
  IF NEW.report_sent_at IS NOT NULL AND OLD.status <> 'reembolsada' THEN
    -- Se NEW.status for em_triagem, com_pendencias, auditada ou NULL
    -- promove para 'fechada'
    IF NEW.status IS NULL OR NEW.status IN ('em_triagem', 'com_pendencias', 'auditada') THEN
      NEW.status := 'fechada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger com nome em ordem alfabética anterior a 'trg_protect_trip_update' (a < t)
-- para que execute ANTES de check_trip_update_allowed() no BEFORE UPDATE.
DROP TRIGGER IF EXISTS "aa_auto_promote_trip_status_on_report_sent" ON public.trips;
DROP TRIGGER IF EXISTS "trg_auto_promote_trip_status_on_report_sent" ON public.trips;

CREATE TRIGGER "aa_auto_promote_trip_status_on_report_sent"
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_promote_trip_status_on_report_sent();

-- 2. Função de trigger para public.standalone_requests
CREATE OR REPLACE FUNCTION public.auto_promote_standalone_request_status_on_report_sent()
RETURNS trigger AS $$
BEGIN
  -- Se o relatório foi enviado (NEW.report_sent_at preenchido)
  -- e a solicitação avulsa NÃO está/estava quitada
  IF NEW.report_sent_at IS NOT NULL AND OLD.status <> 'quitada' THEN
    -- Se NEW.status for em_triagem ou NULL, promove para 'empacotada'
    IF NEW.status IS NULL OR NEW.status = 'em_triagem' THEN
      NEW.status := 'empacotada';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger com nome em ordem alfabética anterior a 'trg_protect_standalone_request' (a < t)
-- para que execute ANTES de check_standalone_request_update_allowed() no BEFORE UPDATE.
DROP TRIGGER IF EXISTS "aa_auto_promote_standalone_request_status_on_report_sent" ON public.standalone_requests;
DROP TRIGGER IF EXISTS "trg_auto_promote_standalone_request_status_on_report_sent" ON public.standalone_requests;

CREATE TRIGGER "aa_auto_promote_standalone_request_status_on_report_sent"
  BEFORE UPDATE ON public.standalone_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_promote_standalone_request_status_on_report_sent();
