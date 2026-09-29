-- Limpar despesas e viagens do teste anterior com dados simulados
DELETE FROM public.expenses 
WHERE created_at >= '2026-09-29 00:00:00+00';

DELETE FROM public.audit_rules_log
WHERE created_at >= '2026-09-29 00:00:00+00';

DELETE FROM public.trips 
WHERE destination = 'Nova Viagem (Agrupamento IA)' 
  AND created_at >= '2026-09-29 00:00:00+00';
