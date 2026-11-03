begin;
-- Accounting joins the canonical department list for every hotel.
-- No staff membership or module grant is created here; operators assign access explicitly.
alter table public.workstel_departments drop constraint workstel_departments_code_check;
alter table public.workstel_departments add constraint workstel_departments_code_check
 check(code in ('front-office','sales','engineering','it','accounting'));
insert into public.workstel_departments(hotel_id,code,name)
select h.id,'accounting','Accounting' from public.workstel_hotels h
on conflict (hotel_id,code) do nothing;

insert into workstel_private.schema_migrations(version) values ('202611040004') on conflict do nothing;
notify pgrst,'reload schema';
commit;
