-- Grant or revoke the platform developer role, which may switch modules on and off.
-- Run as a named operator database account, for example:
--   docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres \
--     -v email=developer@hotel.example -v grant=true < grant-platform-admin.sql
-- Use -v grant=false to revoke. Changes are recorded as platform.admin.* audit events.
begin;
insert into workstel_private.platform_admins(user_id)
select u.id from auth.users u where lower(u.email)=lower(:'email') and :'grant'::boolean
on conflict (user_id) do nothing;
delete from workstel_private.platform_admins a
using auth.users u where u.id=a.user_id and lower(u.email)=lower(:'email') and not :'grant'::boolean;
select u.email,a.created_at as developer_since from workstel_private.platform_admins a
join auth.users u on u.id=a.user_id order by u.email;
commit;
