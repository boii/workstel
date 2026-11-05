-- Remove the "Workstel Test Hotel" created by seed-test-hotel.sql, with every record and grant
-- in it. Only rows of the fixed test hotel ID are touched; no other hotel is affected.
--   docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres < remove-test-hotel.sql
-- Ledger tables are append-only for staff. Their guard triggers are disabled only inside this
-- transaction, which rolls back entirely on any error. Audit events stay as recorded: the
-- audit log is append-only and keeps the history of the test hotel, including the grant
-- removals below (staff.access.delete and staff.module-access.delete).
begin;
do $remove$
declare h constant uuid := '7e570000-0000-4000-8000-000000000001';
begin
 if not exists(select 1 from public.workstel_hotels where id = h and name = 'Workstel Test Hotel') then
  raise notice 'The test hotel does not exist; nothing to remove.';
  return;
 end if;

 delete from workstel_private.module_access where hotel_id = h;
 delete from workstel_private.staff_access where hotel_id = h;

 delete from workstel_private.vault_secret_requests where account_id in (select id from public.vault_accounts where hotel_id = h);
 delete from workstel_private.vault_secrets where account_id in (select id from public.vault_accounts where hotel_id = h);
 delete from workstel_private.vault_shares where account_id in (select id from public.vault_accounts where hotel_id = h);
 delete from workstel_private.vault_department_shares where account_id in (select id from public.vault_accounts where hotel_id = h);
 delete from public.vault_accounts where hotel_id = h;

 delete from public.room_turnaround_tasks where hotel_id = h;
 delete from public.room_turnaround_rooms where hotel_id = h;

 alter table public.sales_activities disable trigger sales_activities_append_only;
 delete from public.sales_activities where hotel_id = h;
 alter table public.sales_activities enable trigger sales_activities_append_only;
 delete from public.sales_deals where hotel_id = h;
 delete from public.sales_accounts where hotel_id = h;

 delete from public.documents_links where hotel_id = h;

 alter table public.bin_card_entries disable trigger bin_card_entries_append_only;
 delete from public.bin_card_entries where hotel_id = h;
 alter table public.bin_card_entries enable trigger bin_card_entries_append_only;
 delete from public.bin_card_items where hotel_id = h;

 alter table public.vehicle_inspections disable trigger vehicle_inspections_append_only;
 delete from public.vehicle_inspections where hotel_id = h;
 alter table public.vehicle_inspections enable trigger vehicle_inspections_append_only;
 delete from public.vehicle_units where hotel_id = h;

 delete from public.workstel_departments where hotel_id = h;
 delete from public.workstel_hotels where id = h;
 raise notice 'Workstel Test Hotel removed.';
end
$remove$;
commit;
