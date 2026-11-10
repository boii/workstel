-- Grant capabilities in an operational module (module grants) to one staff member.
-- Run as a named operator database account after apply-operations-modules.sh, for example:
--   docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres \
--     -v email=staff@hotel.example -v department=front-office -v module=vehicle \
--     -v can_write=true -v can_manage=false < grant-module-access.sql
-- department: front-office | sales | engineering | it | accounting | human-resource |
--   admin-general | housekeeping
-- module: vehicle | bin-card | documents | sales-crm | room-turnaround | casual-attendance
-- Read access is always granted; write records inspections or stock movements; manage edits
-- vehicles or items. The staff member must already have enabled staff_access in that department.
-- Every change is recorded as a staff.module-access.* audit event.
begin;
insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage)
select s.user_id,s.hotel_id,s.department_id,:'module',true,:'can_write'::boolean,:'can_manage'::boolean
from workstel_private.staff_access s
join auth.users u on u.id=s.user_id
join public.workstel_departments d on d.id=s.department_id and d.hotel_id=s.hotel_id
where lower(u.email)=lower(:'email') and d.code=:'department' and s.enabled
on conflict (user_id,hotel_id,department_id,module_id) do update
 set can_read=true,can_write=excluded.can_write,can_manage=excluded.can_manage,enabled=true;
select u.email,d.code as department,m.module_id,m.can_read,m.can_write,m.can_manage
from workstel_private.module_access m
join auth.users u on u.id=m.user_id
join public.workstel_departments d on d.id=m.department_id and d.hotel_id=m.hotel_id
where lower(u.email)=lower(:'email') and m.module_id=:'module';
commit;
