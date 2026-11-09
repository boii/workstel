-- Rolls back migration 202611090003_sales_entry_report.sql.
-- It only removes the report function and its ledger row; no table or activity data is touched.
-- Earlier report reads stay in the audit log as recorded. Deploy a frontend without the
-- Entry report tab first (or together), because the tab calls this function.
begin;
drop function if exists public.sales_entry_report(uuid,uuid,date);
delete from workstel_private.schema_migrations where version='202611090003';
notify pgrst,'reload schema';
commit;
