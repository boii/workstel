begin;
-- Replaces the staff-domain rule from 202611070002: any Google account may create a Workstel
-- account. A new account has no hotel, department or module access until a developer grants it.
-- Every other self-service path (email/password, magic link, phone, anonymous, other providers)
-- is refused, so public sign-up can be switched on for Google alone. Accounts created by a
-- developer carry app_metadata.workstel_admin_created, which only the service role can set.
drop table if exists workstel_private.signup_domains;

create or replace function workstel_private.before_user_created(event jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if event #>> '{user,app_metadata,provider}'='google'
  or event #> '{user,app_metadata,workstel_admin_created}'='true'::jsonb then
  return '{}'::jsonb;
 end if;
 return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Sign-up is not allowed for this account.'));
end$$;
revoke all on function workstel_private.before_user_created(jsonb) from public,anon,authenticated;

do $$
begin
 if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
  grant usage on schema workstel_private to supabase_auth_admin;
  grant execute on function workstel_private.before_user_created(jsonb) to supabase_auth_admin;
 end if;
end$$;
insert into workstel_private.schema_migrations(version) values ('202611070003') on conflict do nothing;
commit;
