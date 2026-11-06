begin;
-- Restricts self-service account creation through Google or another external provider to staff
-- email domains. Supabase Auth calls workstel_private.before_user_created as its "Before User
-- Created" hook; the hook must be enabled in the Auth dashboard before it takes effect.
-- Email/password accounts (created by developers through the admin API) are not affected, and
-- linking Google to an existing account does not create a user, so it is not affected either.
-- With no domains listed, every external-provider sign-up is rejected (fail closed).
create table workstel_private.signup_domains(
 domain text primary key check(domain=lower(domain) and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
 created_at timestamptz not null default clock_timestamp()
);
alter table workstel_private.signup_domains enable row level security;
revoke all on workstel_private.signup_domains from public,anon,authenticated;

create function workstel_private.before_user_created(event jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 provider text:=event #>> '{user,app_metadata,provider}';
 address text:=lower(btrim(coalesce(event #>> '{user,email}','')));
 email_domain text;
begin
 if provider='email' then return '{}'::jsonb;end if;
 -- Exactly one @ with a non-empty local part; the domain must match a listed entry exactly.
 if address !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
  return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Sign-up is not allowed for this account.'));
 end if;
 email_domain:=split_part(address,'@',2);
 if exists(select 1 from workstel_private.signup_domains d where d.domain=email_domain) then
  return '{}'::jsonb;
 end if;
 return jsonb_build_object('error',jsonb_build_object('http_code',403,'message','Sign-up is not allowed for this account.'));
end$$;
revoke all on function workstel_private.before_user_created(jsonb) from public,anon,authenticated;

-- Supabase Auth runs hooks as supabase_auth_admin. Local test databases do not have that role.
do $$
begin
 if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
  grant usage on schema workstel_private to supabase_auth_admin;
  grant execute on function workstel_private.before_user_created(jsonb) to supabase_auth_admin;
 end if;
end$$;
commit;
