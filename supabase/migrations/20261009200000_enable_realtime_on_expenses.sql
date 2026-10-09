-- Garante que a sincronização em tempo real do contador de conferência manual
-- (Supabase Realtime, tela de detalhes da viagem) receba os eventos.
--
-- O realtime.instructions: uma publicação da extensão `supabase_realtime` só
-- entrega eventos de tabelas nela publicadas. Sem isto, o canal criado no app
-- não recebe nenhum evento e a tela não reage em tempo real (aqui a tela segue
-- correta porque o OK aplicado localmente atualiza a lista; a publicação garante
-- o mesmo comportamento para mudanças feitas por outros usuários).
--
-- Migração idempotente: usa ALTER PUBLICATION ... ADD TABLE sem efeito se a
-- tabela já estiver publicada (tratado via DO block, pois não existe
-- "ADD TABLE IF NOT EXISTS").

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'expenses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
  END IF;
END $$;
