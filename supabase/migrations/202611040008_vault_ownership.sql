begin;
-- Vault ownership continuity: transfer, department sharing and developer offboarding.

-- Ciphertext is bound to hotel:account:owner. The owner used for that context is recorded once
-- and never changes, so transferring ownership keeps every stored password readable without
-- re-encryption. Account IDs stay in the context, so ciphertext still cannot move between accounts.
alter table public.vault_accounts add column if not exists secret_owner_id uuid references auth.users(id);
update public.vault_accounts set secret_owner_id=owner_id where secret_owner_id is null;
alter table public.vault_accounts alter column secret_owner_id set not null;
create function workstel_private.vault_secret_owner_default()
returns trigger language plpgsql set search_path='' as $$
begin
 new.secret_owner_id:=coalesce(new.secret_owner_id,new.owner_id);
 return new;
end$$;
revoke all on function workstel_private.vault_secret_owner_default() from public,anon,authenticated;
create trigger vault_secret_owner_default before insert on public.vault_accounts
 for each row execute function workstel_private.vault_secret_owner_default();
create function workstel_private.vault_secret_owner_fixed()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.secret_owner_id is distinct from old.secret_owner_id then raise exception 'The encryption owner of a Vault account cannot change';end if;
 return new;
end$$;
revoke all on function workstel_private.vault_secret_owner_fixed() from public,anon,authenticated;
create trigger vault_secret_owner_fixed before update on public.vault_accounts
 for each row execute function workstel_private.vault_secret_owner_fixed();

-- Read-only sharing with every enabled reader of a department at the same hotel.
create table workstel_private.vault_department_shares(
 account_id uuid not null references public.vault_accounts(id),department_id uuid not null references public.workstel_departments(id),
 granted_by uuid not null references auth.users(id),granted_at timestamptz not null default clock_timestamp(),
 primary key(account_id,department_id)
);
alter table workstel_private.vault_department_shares enable row level security;
revoke all on workstel_private.vault_department_shares from public,anon,authenticated;
create index vault_department_shares_department_idx on workstel_private.vault_department_shares(department_id,account_id);

create or replace function workstel_private.account_allowed_for(p_actor uuid,p_account uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vault_accounts v where v.id=p_account and
 case p_permission
 when 'read' then exists(select 1 from workstel_private.staff_access a where a.user_id=p_actor and a.enabled and a.can_read and a.hotel_id=v.hotel_id)
 and (v.owner_id=p_actor
  or exists(select 1 from workstel_private.vault_shares s where s.account_id=v.id and s.recipient_id=p_actor)
  or exists(select 1 from workstel_private.vault_department_shares ds
   join workstel_private.staff_access a on a.user_id=p_actor and a.enabled and a.can_read and a.hotel_id=v.hotel_id and a.department_id=ds.department_id
   where ds.account_id=v.id))
 when 'write' then v.owner_id=p_actor and exists(select 1 from workstel_private.staff_access a where a.user_id=p_actor and a.enabled and a.can_write and a.hotel_id=v.hotel_id and a.department_id=v.department_id)
 when 'archive' then v.owner_id=p_actor and exists(select 1 from workstel_private.staff_access a where a.user_id=p_actor and a.enabled and a.can_archive and a.hotel_id=v.hotel_id and a.department_id=v.department_id)
 else false end)
$$;

-- Same as 202611010004 except that the encryption context uses the recorded secret owner.
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
 return jsonb_build_object('data',jsonb_build_object('id',account.id,'hotelId',account.hotel_id,'ownerId',account.secret_owner_id,'accountVersion',account.version,'secretVersion',coalesce(secret.version,0),'ciphertext',case when p_action='reveal' then secret.ciphertext else null end));
end$$;

-- Owners list both people and departments they share with, plus the departments they could use.
create or replace function public.vault_list_shares(p_hotel_id uuid,p_account_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; result jsonb; departments jsonb; available jsonb;
begin
 select * into account from public.vault_accounts where id=p_account_id and hotel_id=p_hotel_id;
 if not found or account.owner_id<>auth.uid() or not workstel_private.account_allowed(p_account_id,'read') then
  insert into workstel_private.audit_events(actor_id,hotel_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_account_id,'vault.share.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('email',u.email,'grantedAt',s.granted_at) order by s.granted_at),'[]'::jsonb) into result
 from workstel_private.vault_shares s join auth.users u on u.id=s.recipient_id where s.account_id=p_account_id;
 select coalesce(jsonb_agg(jsonb_build_object('departmentId',d.id,'name',d.name,'grantedAt',ds.granted_at) order by d.name),'[]'::jsonb) into departments
 from workstel_private.vault_department_shares ds join public.workstel_departments d on d.id=ds.department_id where ds.account_id=p_account_id;
 select coalesce(jsonb_agg(jsonb_build_object('departmentId',d.id,'name',d.name) order by d.name),'[]'::jsonb) into available
 from public.workstel_departments d where d.hotel_id=p_hotel_id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'vault.share.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('version',account.version,'departments',departments,'availableDepartments',available));
end$$;

create function public.vault_set_department_share(p_hotel_id uuid,p_account_id uuid,p_department_id uuid,p_expected_version integer,p_action text default 'grant')
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts;
begin
 select * into account from public.vault_accounts where id=p_account_id and hotel_id=p_hotel_id for update;
 if not found or account.owner_id<>auth.uid() or not workstel_private.account_allowed(p_account_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_account_id,'vault.share.department','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('grant','revoke')
  or not exists(select 1 from public.workstel_departments d where d.id=p_department_id and d.hotel_id=p_hotel_id) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_expected_version is null or account.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 if p_action='grant' then
  insert into workstel_private.vault_department_shares(account_id,department_id,granted_by) values(p_account_id,p_department_id,auth.uid()) on conflict do nothing;
 else
  delete from workstel_private.vault_department_shares where account_id=p_account_id and department_id=p_department_id;
 end if;
 update public.vault_accounts set version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_account_id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome)
 values(auth.uid(),p_hotel_id,p_department_id,p_account_id,'vault.share.department.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('version',account.version+1));
end$$;

-- Moves one account to a new owner who can write in its department. The new owner's personal
-- share becomes redundant and is removed; the previous owner may keep read-only access.
create function workstel_private.vault_move_owner(p_actor uuid,p_account public.vault_accounts,p_new_owner uuid,p_keep_reader boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from workstel_private.vault_shares where account_id=p_account.id and recipient_id=p_new_owner;
 if p_keep_reader then
  insert into workstel_private.vault_shares(account_id,recipient_id,granted_by) values(p_account.id,p_account.owner_id,p_actor) on conflict do nothing;
 end if;
 update public.vault_accounts set owner_id=p_new_owner,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor where id=p_account.id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,target_user_id)
 values(p_actor,p_account.hotel_id,p_account.department_id,p_account.id,'vault.ownership.transfer','success',p_new_owner);
end$$;
revoke all on function workstel_private.vault_move_owner(uuid,public.vault_accounts,uuid,boolean) from public,anon,authenticated;

create function workstel_private.vault_can_own(p_user uuid,p_account public.vault_accounts)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from workstel_private.staff_access a where a.user_id=p_user and a.enabled and a.can_write and a.hotel_id=p_account.hotel_id and a.department_id=p_account.department_id) $$;
revoke all on function workstel_private.vault_can_own(uuid,public.vault_accounts) from public,anon,authenticated;

create function public.vault_transfer_owner(p_hotel_id uuid,p_account_id uuid,p_email text,p_expected_version integer,p_keep_reader boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; recipient uuid;
begin
 select * into account from public.vault_accounts where id=p_account_id and hotel_id=p_hotel_id for update;
 if not found or account.owner_id<>auth.uid() or not workstel_private.account_allowed(p_account_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_account_id,'vault.ownership.transfer','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_email is null or length(trim(p_email)) not between 3 and 254 or p_keep_reader is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_expected_version is null or account.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 select u.id into recipient from auth.users u where lower(u.email)=lower(trim(p_email));
 if recipient is null or recipient=auth.uid() or not workstel_private.vault_can_own(recipient,account) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'vault.ownership.transfer','denied');
  return jsonb_build_object('error','RECIPIENT_UNAVAILABLE');
 end if;
 perform workstel_private.vault_move_owner(auth.uid(),account,recipient,p_keep_reader);
 return jsonb_build_object('data',jsonb_build_object('version',account.version+1));
end$$;

-- Developer offboarding: see and move everything a user owns. Developers do not gain read access.
create function public.vault_admin_owned_accounts(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,resource_id,action,outcome) values(auth.uid(),p_user_id,'vault.ownership.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'status',v.status,'departmentName',d.name) order by lower(v.name)),'[]'::jsonb) into result
 from public.vault_accounts v join public.workstel_departments d on d.id=v.department_id and d.hotel_id=v.hotel_id where v.owner_id=p_user_id;
 insert into workstel_private.audit_events(actor_id,action,outcome,target_user_id) values(auth.uid(),'vault.ownership.list','success',p_user_id);
 return jsonb_build_object('data',result);
end$$;

create function public.vault_admin_transfer_accounts(p_from uuid,p_to uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; moved integer:=0; skipped jsonb:='[]'::jsonb; department_name text;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,resource_id,action,outcome,target_user_id) values(auth.uid(),p_from,'vault.ownership.transfer','denied',p_to);
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_from is null or p_to is null or p_from=p_to or not exists(select 1 from auth.users where id=p_to) then return jsonb_build_object('error','INVALID_INPUT');end if;
 for account in select * from public.vault_accounts where owner_id=p_from order by id for update loop
  if workstel_private.vault_can_own(p_to,account) then
   perform workstel_private.vault_move_owner(auth.uid(),account,p_to,false);
   moved:=moved+1;
  else
   select d.name into department_name from public.workstel_departments d where d.id=account.department_id;
   skipped:=skipped||jsonb_build_object('id',account.id,'name',account.name,'departmentName',department_name);
  end if;
 end loop;
 return jsonb_build_object('data',jsonb_build_object('transferred',moved,'skipped',skipped));
end$$;

revoke all on function public.vault_set_department_share(uuid,uuid,uuid,integer,text) from public,anon;
revoke all on function public.vault_transfer_owner(uuid,uuid,text,integer,boolean) from public,anon;
revoke all on function public.vault_admin_owned_accounts(uuid) from public,anon;
revoke all on function public.vault_admin_transfer_accounts(uuid,uuid) from public,anon;
grant execute on function public.vault_set_department_share(uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.vault_transfer_owner(uuid,uuid,text,integer,boolean) to authenticated;
grant execute on function public.vault_admin_owned_accounts(uuid) to authenticated;
grant execute on function public.vault_admin_transfer_accounts(uuid,uuid) to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611040008') on conflict do nothing;
notify pgrst,'reload schema';
commit;
