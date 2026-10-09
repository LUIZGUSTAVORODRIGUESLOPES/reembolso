-- Migration: Criar tabela standalone_requests para Solicitações Avulsas de Reembolso
-- Puramente aditiva: não altera tabelas existentes nem afeta dados legados de viagens.

CREATE TABLE IF NOT EXISTS public.standalone_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Equipamento',
  expense_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  merchant_name TEXT DEFAULT '',
  cnpj TEXT DEFAULT '',
  receipt_url TEXT NOT NULL DEFAULT '',
  receipt_file_name TEXT NOT NULL DEFAULT '',
  receipt_storage_path TEXT,
  ocr_raw_text TEXT,
  status TEXT NOT NULL DEFAULT 'em_triagem', -- 'em_triagem' | 'empacotada' | 'quitada'
  
  -- Rastreamento de envio por e-mail (empacotamento)
  report_sent_at TIMESTAMPTZ,
  report_sent_to TEXT,
  report_sent_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_sent_by_name TEXT,
  
  -- Quitação (individual ou em lote conjunto)
  settlement_date DATE,
  settlement_amount NUMERIC,
  settlement_deposit_total NUMERIC,
  settlement_batch_id UUID,
  settlement_batch_count INTEGER,
  settled_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_by_name TEXT,
  settled_at TIMESTAMPTZ,
  
  -- Governança de reabertura (apenas admin pode reabrir empacotadas para em_triagem)
  reopened_at TIMESTAMPTZ,
  reopened_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_by_name TEXT,
  reopen_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance e filtros
CREATE INDEX IF NOT EXISTS idx_standalone_requests_user_id ON public.standalone_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_standalone_requests_status ON public.standalone_requests(status);
CREATE INDEX IF NOT EXISTS idx_standalone_requests_expense_date ON public.standalone_requests(expense_date);
CREATE INDEX IF NOT EXISTS idx_standalone_requests_created_at ON public.standalone_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_standalone_requests_settlement_batch_id ON public.standalone_requests(settlement_batch_id);

-- RLS
ALTER TABLE public.standalone_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "standalone_requests_select_policy" ON public.standalone_requests;
CREATE POLICY "standalone_requests_select_policy" ON public.standalone_requests
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "standalone_requests_insert_policy" ON public.standalone_requests;
CREATE POLICY "standalone_requests_insert_policy" ON public.standalone_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "standalone_requests_update_policy" ON public.standalone_requests;
CREATE POLICY "standalone_requests_update_policy" ON public.standalone_requests
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "standalone_requests_delete_policy" ON public.standalone_requests;
CREATE POLICY "standalone_requests_delete_policy" ON public.standalone_requests
  FOR DELETE TO authenticated
  USING (
    (public.is_admin(auth.uid()) OR user_id = auth.uid())
    AND status = 'em_triagem'
  );

-- Triggers de Governança e Proteção de Imutabilidade
CREATE OR REPLACE FUNCTION public.check_standalone_request_update_allowed()
RETURNS trigger AS $$
DECLARE
  v_is_reopen BOOLEAN;
BEGIN
  -- Reabertura permitida: apenas de 'empacotada' para 'em_triagem'
  v_is_reopen := (OLD.status = 'empacotada' AND NEW.status = 'em_triagem');

  -- 1. Se estava quitada, NADA pode mudar. A quitação é definitiva.
  IF OLD.status = 'quitada' THEN
    RAISE EXCEPTION 'Não é permitido alterar ou retroceder uma solicitação avulsa já quitada. A quitação é definitiva.'
      USING ERRCODE = '23505';
  END IF;

  -- 2. Se estava empacotada e NÃO é reabertura para 'em_triagem' nem quitação para 'quitada',
  -- não permite alterar dados principais (description, category, expense_date, amount, receipt)
  IF OLD.status = 'empacotada' AND NOT v_is_reopen AND NEW.status <> 'quitada' THEN
    IF (OLD.description IS DISTINCT FROM NEW.description) OR
       (OLD.category IS DISTINCT FROM NEW.category) OR
       (OLD.expense_date IS DISTINCT FROM NEW.expense_date) OR
       (OLD.amount IS DISTINCT FROM NEW.amount) OR
       (OLD.receipt_url IS DISTINCT FROM NEW.receipt_url) THEN
      RAISE EXCEPTION 'Não é permitido modificar os dados fiscais ou o comprovante de uma solicitação com status "empacotada". Solicite a reabertura para realizar correções.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 3. Transição direta inválida
  IF OLD.status = 'em_triagem' AND NEW.status = 'quitada' THEN
    RAISE EXCEPTION 'A solicitação precisa ser empacotada (enviada por e-mail) antes de poder ser quitada.'
      USING ERRCODE = '23505';
  END IF;

  -- Atualizar timestamp
  NEW.updated_at := now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_standalone_request ON public.standalone_requests;
CREATE TRIGGER trg_protect_standalone_request
  BEFORE UPDATE ON public.standalone_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.check_standalone_request_update_allowed();

-- Proibir exclusão de solicitações empacotadas ou quitadas
CREATE OR REPLACE FUNCTION public.check_standalone_request_delete_allowed()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('empacotada', 'quitada') THEN
    RAISE EXCEPTION 'Não é permitido excluir uma solicitação avulsa empacotada ou quitada.'
      USING ERRCODE = '23505';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_standalone_request_delete ON public.standalone_requests;
CREATE TRIGGER trg_protect_standalone_request_delete
  BEFORE DELETE ON public.standalone_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.check_standalone_request_delete_allowed();
