-- Migration: Add deletion protection triggers for closed/reimbursed trips and their expenses

-- 1. Function to protect trips from being deleted if status is 'fechada' or 'reembolsada'
CREATE OR REPLACE FUNCTION public.check_trip_delete_allowed()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('fechada', 'reembolsada') THEN
    RAISE EXCEPTION 'Não é permitido excluir uma viagem com status "%" (fechada ou reembolsada). O processo é imutável após emissão.', OLD.status
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

-- 2. Function to protect expenses from being deleted if their associated trip is 'fechada' or 'reembolsada'
CREATE OR REPLACE FUNCTION public.check_expense_delete_allowed()
RETURNS trigger AS $$
DECLARE
  v_trip_status TEXT;
BEGIN
  IF OLD.trip_id IS NOT NULL THEN
    SELECT status INTO v_trip_status
    FROM public.trips
    WHERE id = OLD.trip_id;

    IF v_trip_status IN ('fechada', 'reembolsada') THEN
      RAISE EXCEPTION 'Não é permitido excluir despesas de uma viagem com status "%" (fechada ou reembolsada).', v_trip_status
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
