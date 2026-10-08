-- Migration: Imutabilidade e Governança de Viagens Fechadas, Auditadas ou Reembolsadas
-- Bloqueia alterações em despesas e nos campos principais de viagens quando status IN ('auditada', 'fechada', 'reembolsada').

-- 1. Atualizar trigger de exclusão de viagem para incluir status 'auditada'
CREATE OR REPLACE FUNCTION public.check_trip_delete_allowed()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('auditada', 'fechada', 'reembolsada') THEN
    RAISE EXCEPTION 'Não é permitido excluir uma viagem com status "%" (auditada, fechada ou reembolsada). O processo é imutável.', OLD.status
      USING ERRCODE = '23505';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_trip_deletion ON public.trips;
CREATE TRIGGER trg_protect_trip_deletion
  BEFORE DELETE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.check_trip_delete_allowed();

-- 2. Trigger para atualização de viagens (proteger campos principais se status fechado/auditado/reembolsado)
-- Campos protegidos: destination, start_date, end_date, transport_type
-- Alterações legítimas de status (ex: avançar de auditada para fechada ou reembolsada) continuam permitidas.
CREATE OR REPLACE FUNCTION public.check_trip_update_allowed()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('auditada', 'fechada', 'reembolsada') THEN
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

DROP TRIGGER IF EXISTS trg_protect_trip_update ON public.trips;
CREATE TRIGGER trg_protect_trip_update
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.check_trip_update_allowed();

-- 3. Atualizar função de exclusão de despesa para incluir status 'auditada'
CREATE OR REPLACE FUNCTION public.check_expense_delete_allowed()
RETURNS trigger AS $$
DECLARE
  v_trip_status TEXT;
BEGIN
  IF OLD.trip_id IS NOT NULL THEN
    SELECT status INTO v_trip_status
    FROM public.trips
    WHERE id = OLD.trip_id;

    IF v_trip_status IN ('auditada', 'fechada', 'reembolsada') THEN
      RAISE EXCEPTION 'Não é permitido excluir despesas de uma viagem com status "%" (auditada, fechada ou reembolsada).', v_trip_status
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_expense_deletion ON public.expenses;
CREATE TRIGGER trg_protect_expense_deletion
  BEFORE DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.check_expense_delete_allowed();

-- 4. Trigger para inserção de despesas em viagens fechadas/auditadas/reembolsadas
CREATE OR REPLACE FUNCTION public.check_expense_insert_allowed()
RETURNS trigger AS $$
DECLARE
  v_trip_status TEXT;
BEGIN
  IF NEW.trip_id IS NOT NULL THEN
    SELECT status INTO v_trip_status
    FROM public.trips
    WHERE id = NEW.trip_id;

    IF v_trip_status IN ('auditada', 'fechada', 'reembolsada') THEN
      RAISE EXCEPTION 'Não é permitido adicionar despesas a uma viagem com status "%" (auditada, fechada ou reembolsada).', v_trip_status
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_expense_insertion ON public.expenses;
CREATE TRIGGER trg_protect_expense_insertion
  BEFORE INSERT ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.check_expense_insert_allowed();

-- 5. Trigger para atualização de despesas vinculadas a viagens fechadas/auditadas/reembolsadas
CREATE OR REPLACE FUNCTION public.check_expense_update_allowed()
RETURNS trigger AS $$
DECLARE
  v_old_trip_status TEXT;
  v_new_trip_status TEXT;
BEGIN
  -- Verificar se a despesa já pertencia a uma viagem fechada
  IF OLD.trip_id IS NOT NULL THEN
    SELECT status INTO v_old_trip_status
    FROM public.trips
    WHERE id = OLD.trip_id;

    IF v_old_trip_status IN ('auditada', 'fechada', 'reembolsada') THEN
      RAISE EXCEPTION 'Não é permitido modificar despesas de uma viagem com status "%" (auditada, fechada ou reembolsada).', v_old_trip_status
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Se foi reatribuída para outra viagem, verificar se o destino também está fechado
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

DROP TRIGGER IF EXISTS trg_protect_expense_update ON public.expenses;
CREATE TRIGGER trg_protect_expense_update
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.check_expense_update_allowed();
