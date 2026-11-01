begin;
-- Fail closed rather than orphan legacy ciphertext. Convert existing rows first.
lock table workstel_private.vault_secrets in access exclusive mode;
do $$begin
 if exists(select 1 from workstel_private.vault_secrets where ciphertext !~ '^workstel:aesgcm:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/=]+$') then
 raise exception 'Legacy secrets require conversion before switching encryption';end if;
end$$;
alter table workstel_private.vault_secrets drop constraint vault_secrets_ciphertext_check;
alter table workstel_private.vault_secrets add constraint vault_secrets_ciphertext_check check(length(ciphertext)<=65536 and ciphertext ~ '^workstel:aesgcm:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/=]+$');
create or replace function public.vault_secret_service_status()
returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('data',jsonb_build_object('schema','aesgcm-v1'))$$;
create or replace function public.vault_secret_commit(p_actor uuid,p_account_id uuid,p_account_version integer,p_expected_version integer,p_request_id uuid,p_ciphertext text,p_auth_time bigint,p_correlation_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; current_version integer; replay workstel_private.vault_secret_requests;
begin
 select * into account from public.vault_accounts where id=p_account_id for update;
 if not found or account.status<>'active' or not workstel_private.account_allowed_for(p_actor,p_account_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,correlation_id) values(p_actor,account.hotel_id,account.department_id,p_account_id,'vault.secret.write','denied',p_correlation_id);
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if not workstel_private.recent_auth(p_auth_time) then return jsonb_build_object('error','REAUTH_REQUIRED');end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_ciphertext is null or length(p_ciphertext)>65536 or p_ciphertext !~ '^workstel:aesgcm:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/=]+$' then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into replay from workstel_private.vault_secret_requests where request_id=p_request_id;
 if found then
  if replay.actor_id<>p_actor or replay.account_id<>p_account_id then return jsonb_build_object('error','VERSION_CONFLICT');end if;
  return jsonb_build_object('data',jsonb_build_object('version',replay.secret_version,'accountVersion',replay.account_version));
 end if;
 select version into current_version from workstel_private.vault_secrets where account_id=p_account_id;
 current_version:=coalesce(current_version,0);
 if p_account_version is null or account.version<>p_account_version or current_version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 insert into workstel_private.vault_secrets(account_id,ciphertext,version) values(p_account_id,p_ciphertext,current_version+1)
 on conflict(account_id) do update set ciphertext=excluded.ciphertext,version=excluded.version,updated_at=clock_timestamp();
 update public.vault_accounts set version=version+1,updated_by=p_actor,updated_at=clock_timestamp() where id=p_account_id;
 insert into workstel_private.vault_secret_requests(request_id,actor_id,account_id,secret_version,account_version) values(p_request_id,p_actor,p_account_id,current_version+1,account.version+1);
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,correlation_id) values(p_actor,account.hotel_id,account.department_id,p_account_id,'vault.secret.write','success',p_correlation_id);
 return jsonb_build_object('data',jsonb_build_object('version',current_version+1,'accountVersion',account.version+1));
end$$;


insert into workstel_private.schema_migrations(version) values ('202611010005') on conflict do nothing;
notify pgrst,'reload schema';
commit;
