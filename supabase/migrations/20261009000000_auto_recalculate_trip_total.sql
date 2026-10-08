-- Migration: Auto recalculate trip total amount on expense changes
-- Recalcula automaticamente o total da viagem (trips.total_amount) sempre que despesas forem inseridas,
-- atualizadas (incluindo mudança de trip_id ou valor) ou excluídas.

CREATE OR REPLACE FUNCTION public.recalculate_trip_total_on_expense_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 1. Se for DELETE ou UPDATE (que pode ter trip_id antigo):
  IF TG_OP = 'DELETE' THEN
    IF OLD.trip_id IS NOT NULL THEN
      UPDATE public.trips
      SET total_amount = COALESCE(
        (SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2)
         FROM public.expenses
         WHERE trip_id = OLD.trip_id),
        0
      )
      WHERE id = OLD.trip_id;
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Se o trip_id mudou:
    IF OLD.trip_id IS DISTINCT FROM NEW.trip_id THEN
      -- Recalcula a viagem de ORIGEM (caso causador do bug relatado)
      IF OLD.trip_id IS NOT NULL THEN
        UPDATE public.trips
        SET total_amount = COALESCE(
          (SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2)
           FROM public.expenses
           WHERE trip_id = OLD.trip_id),
          0
        )
        WHERE id = OLD.trip_id;
      END IF;

      -- Recalcula a viagem de DESTINO
      IF NEW.trip_id IS NOT NULL THEN
        UPDATE public.trips
        SET total_amount = COALESCE(
          (SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2)
           FROM public.expenses
           WHERE trip_id = NEW.trip_id),
          0
        )
        WHERE id = NEW.trip_id;
      END IF;
    ELSE
      -- O trip_id não mudou, mas o amount ou outro campo pode ter mudado
      IF NEW.trip_id IS NOT NULL THEN
        UPDATE public.trips
        SET total_amount = COALESCE(
          (SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2)
           FROM public.expenses
           WHERE trip_id = NEW.trip_id),
          0
        )
        WHERE id = NEW.trip_id;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.trip_id IS NOT NULL THEN
      UPDATE public.trips
      SET total_amount = COALESCE(
        (SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2)
         FROM public.expenses
         WHERE trip_id = NEW.trip_id),
        0
      )
      WHERE id = NEW.trip_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- Criar trigger AFTER INSERT OR UPDATE OR DELETE na tabela expenses
DROP TRIGGER IF EXISTS trg_recalculate_trip_total ON public.expenses;

CREATE TRIGGER trg_recalculate_trip_total
AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_trip_total_on_expense_change();

-- Sincronização inicial de garantia: assegurar que todos os totais em public.trips
-- reflitam com precisão cirúrgica a soma real das despesas atualmente vinculadas.
UPDATE public.trips t
SET total_amount = COALESCE(
  (SELECT ROUND(COALESCE(SUM(e.amount), 0)::numeric, 2)
   FROM public.expenses e
   WHERE e.trip_id = t.id),
  0
);
