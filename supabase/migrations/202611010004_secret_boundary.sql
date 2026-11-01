begin;
create table if not exists workstel_private.vault_secrets(
 account_id uuid primary key references public.vault_accounts(id),
 ciphertext text not null check(length(ciphertext)<=65536 and ciphertext ~ '^vault:v[0-9]+:[A-Za-z0-9+/=]+$'),
 version integer not null check(version>0),updated_at timestamptz not null default clock_timestamp()
);
create table if not exists workstel_private.vault_secret_requests(
 request_id uuid primary key,actor_id uuid not null,account_id uuid not null references public.vault_accounts(id),
 secret_version integer not null,account_version integer not null,occurred_at timestamptz not null default clock_timestamp()
);
alter table workstel_private.vault_secrets enable row level security;
alter table workstel_private.vault_secret_requests enable row level security;
revoke all on workstel_private.vault_secrets,workstel_private.vault_secret_requests from public,anon,authenticated,service_role;
create index if not exists vault_secret_rate_idx on workstel_private.audit_events(actor_id,occurred_at desc) where action in ('vault.secret.inspect.request','vault.secret.write.request','vault.secret.reveal.request');

create or replace function workstel_private.account_allowed_for(p_actor uuid,p_account uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vault_accounts v where v.id=p_account and
 case p_permission
 when 'read' then exists(select 1 from workstel_private.staff_access a where a.user_id=p_actor and a.enabled and a.can_read and a.hotel_id=v.hotel_id)
 and (v.owner_id=p_actor or exists(select 1 from workstel_private.vault_shares s where s.account_id=v.id and s.recipient_id=p_actor))
 when 'write' then v.owner_id=p_actor and exists(select 1 from workstel_private.staff_access a where a.user_id=p_actor and a.enabled and a.can_write and a.hotel_id=v.hotel_id and a.department_id=v.department_id)
 when 'archive' then v.owner_id=p_actor and exists(select 1 from workstel_private.staff_access a where a.user_id=p_actor and a.enabled and a.can_archive and a.hotel_id=v.hotel_id and a.department_id=v.department_id)
 else false end)
$$;
create or replace function workstel_private.account_allowed(p_account uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$select workstel_private.account_allowed_for(auth.uid(),p_account,p_permission)$$;
create or replace function workstel_private.recent_auth(p_time bigint)
returns boolean language sql stable set search_path='' as $$select p_time is not null and p_time between extract(epoch from now())-300 and extract(epoch from now())+30$$;
revoke all on function workstel_private.account_allowed_for(uuid,uuid,text),workstel_private.recent_auth(bigint) from public,anon,authenticated,service_role;

create or replace function public.vault_secret_service_status()
returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('data',jsonb_build_object('schema','transit-v1'))$$;

create or replace function public.vault_secret_prepare(p_actor uuid,p_account_id uuid,p_action text,p_auth_time bigint,p_correlation_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; secret workstel_private.vault_secrets; permission text; denied text;
begin
 if p_action is null or p_action not in ('inspect','write','reveal') then return jsonb_build_object('error','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(p_actor::text,''),0));
 if (select count(*) from workstel_private.audit_events where actor_id=p_actor and action in ('vault.secret.inspect.request','vault.secret.write.request','vault.secret.reveal.request') and occurred_at>clock_timestamp()-interval '1 minute')>=30 then return jsonb_build_object('error','RATE_LIMITED');end if;
 select * into account from public.vault_accounts where id=p_account_id for update;
 permission:=case when p_action='write' then 'write' else 'read' end;
 if not found or account.status<>'active' or not workstel_private.account_allowed_for(p_actor,p_account_id,permission) then denied:='ACCESS_DENIED';
 elsif p_action<>'inspect' and not workstel_private.recent_auth(p_auth_time) then denied:='REAUTH_REQUIRED';end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,correlation_id)
 values(p_actor,account.hotel_id,account.department_id,p_account_id,'vault.secret.'||p_action||'.request',case when denied is null then 'success' else 'denied' end,p_correlation_id);
 if denied is not null then return jsonb_build_object('error',denied);end if;
 select * into secret from workstel_private.vault_secrets where account_id=p_account_id;
 if p_action='reveal' and not found then return jsonb_build_object('error','SECRET_UNAVAILABLE');end if;
 return jsonb_build_object('data',jsonb_build_object('id',account.id,'hotelId',account.hotel_id,'ownerId',account.owner_id,'accountVersion',account.version,'secretVersion',coalesce(secret.version,0),'ciphertext',case when p_action='reveal' then secret.ciphertext else null end));
end$$;

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
 if p_request_id is null or p_expected_version is null or p_expected_version<0 or p_ciphertext is null or length(p_ciphertext)>65536 or p_ciphertext !~ '^vault:v[0-9]+:[A-Za-z0-9+/=]+$' then return jsonb_build_object('error','INVALID_INPUT');end if;
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

create or replace function public.vault_secret_finish_reveal(p_actor uuid,p_account_id uuid,p_account_version integer,p_secret_version integer,p_auth_time bigint,p_correlation_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; secret_version integer; denied text;
begin
 select * into account from public.vault_accounts where id=p_account_id for update;
 if not found or account.status<>'active' or not workstel_private.account_allowed_for(p_actor,p_account_id,'read') then denied:='ACCESS_DENIED';
 elsif not workstel_private.recent_auth(p_auth_time) then denied:='REAUTH_REQUIRED';
 else
  select version into secret_version from workstel_private.vault_secrets where account_id=p_account_id;
  if p_account_version is null or p_secret_version is null or account.version<>p_account_version or secret_version is null or secret_version<>p_secret_version then denied:='VERSION_CONFLICT';end if;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,correlation_id)
 values(p_actor,account.hotel_id,account.department_id,p_account_id,'vault.secret.reveal',case when denied is null then 'success' else 'denied' end,p_correlation_id);
 if denied is not null then return jsonb_build_object('error',denied);end if;
 return jsonb_build_object('data',jsonb_build_object('authorized',true));
end$$;

create or replace function public.vault_secret_failed(p_actor uuid,p_account_id uuid,p_correlation_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts;
begin
 select * into account from public.vault_accounts where id=p_account_id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,correlation_id)
 values(p_actor,account.hotel_id,account.department_id,p_account_id,'vault.secret.backend','denied',p_correlation_id);
 return jsonb_build_object('data',jsonb_build_object('recorded',true));
end$$;

revoke all on function public.vault_secret_service_status(),public.vault_secret_prepare(uuid,uuid,text,bigint,uuid),public.vault_secret_commit(uuid,uuid,integer,integer,uuid,text,bigint,uuid),public.vault_secret_finish_reveal(uuid,uuid,integer,integer,bigint,uuid),public.vault_secret_failed(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.vault_secret_service_status(),public.vault_secret_prepare(uuid,uuid,text,bigint,uuid),public.vault_secret_commit(uuid,uuid,integer,integer,uuid,text,bigint,uuid),public.vault_secret_finish_reveal(uuid,uuid,integer,integer,bigint,uuid),public.vault_secret_failed(uuid,uuid,uuid) to service_role;
insert into workstel_private.schema_migrations(version) values ('202611010004') on conflict do nothing;
notify pgrst,'reload schema';
commit;
