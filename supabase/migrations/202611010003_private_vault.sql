begin;
-- Existing records become private to their original creator; no account is deleted.
alter table public.vault_accounts add column if not exists owner_id uuid references auth.users(id);
update public.vault_accounts set owner_id=created_by where owner_id is null;
alter table public.vault_accounts alter column owner_id set not null;
alter table public.vault_accounts alter column owner_id set default auth.uid();
alter table workstel_private.audit_events add column if not exists target_user_id uuid;
insert into workstel_private.audit_events(hotel_id,department_id,resource_id,action,outcome,target_user_id)
select v.hotel_id,v.department_id,v.id,'vault.ownership.initialize','success',v.owner_id from public.vault_accounts v
where not exists(select 1 from workstel_private.audit_events e where e.resource_id=v.id and e.action='vault.ownership.initialize');
create table if not exists workstel_private.vault_shares(
 account_id uuid not null references public.vault_accounts(id), recipient_id uuid not null references auth.users(id),
 granted_by uuid not null references auth.users(id), granted_at timestamptz not null default clock_timestamp(),
 primary key(account_id,recipient_id)
);
alter table workstel_private.vault_shares enable row level security;
revoke all on workstel_private.vault_shares from public,anon,authenticated;
create index if not exists vault_shares_recipient_idx on workstel_private.vault_shares(recipient_id,account_id);
create index if not exists vault_accounts_owner_idx on public.vault_accounts(owner_id,hotel_id,id);
create or replace function workstel_private.account_allowed(p_account uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vault_accounts v where v.id=p_account and
 case p_permission
 when 'read' then
  exists(select 1 from workstel_private.staff_access a where a.user_id=auth.uid() and a.enabled and a.can_read and a.hotel_id=v.hotel_id)
  and (v.owner_id=auth.uid() or exists(select 1 from workstel_private.vault_shares s where s.account_id=v.id and s.recipient_id=auth.uid()))
 when 'write' then v.owner_id=auth.uid() and workstel_private.allowed(v.hotel_id,v.department_id,'write')
 when 'archive' then v.owner_id=auth.uid() and workstel_private.allowed(v.hotel_id,v.department_id,'archive')
 else false end)
$$;
revoke all on function workstel_private.account_allowed(uuid,text) from public,anon,authenticated;
create or replace function public.vault_list_accounts(p_hotel_id uuid,p_department_id uuid default null,p_status text default 'active',p_search text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; authorized boolean;
begin
 select exists(select 1 from workstel_private.staff_access a where a.user_id=auth.uid() and a.enabled and a.can_read and a.hotel_id=p_hotel_id and (p_department_id is null or a.department_id=p_department_id)) into authorized;
 if not authorized then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vault.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_status not in ('active','archived','all') or p_status is null or p_limit is null or p_limit<1 or p_limit>100 or length(p_search)>150 then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.id),'[]'::jsonb) into result from (
 select v.id,v.hotel_id,v.department_id,v.owner_id,(v.owner_id=auth.uid()) as is_owner,workstel_private.account_allowed(v.id,'write') as can_edit,workstel_private.account_allowed(v.id,'archive') as can_archive,d.code as department_code,v.name,v.username,v.website,v.notes,v.status,v.version,v.created_at,v.updated_at,v.created_by,v.updated_by
 from public.vault_accounts v join public.workstel_departments d on d.hotel_id=v.hotel_id and d.id=v.department_id
 where v.hotel_id=p_hotel_id and workstel_private.account_allowed(v.id,'read')
 and (p_department_id is null or v.department_id=p_department_id)
 and (p_status='all' or v.status=p_status)
 and (p_after is null or v.id>p_after)
 and (p_search='' or v.name ilike '%'||p_search||'%' or v.username ilike '%'||p_search||'%' or v.website ilike '%'||p_search||'%')
 order by v.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vault.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

create or replace function public.vault_write_metadata(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_account_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; required_permission text; existing public.vault_accounts;
begin
 required_permission:=case when p_action in ('archive','restore') then 'archive' else 'write' end;
 if not workstel_private.allowed(p_hotel_id,p_department_id,required_permission) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_account_id,'vault.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_account_id is not null then
  select * into existing from public.vault_accounts where id=p_account_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.account_allowed(existing.id,required_permission) then
   insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_account_id,'vault.write','denied');
   return jsonb_build_object('error','ACCESS_DENIED');
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object' then return jsonb_build_object('error','INVALID_INPUT');end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','username','website','notes')) then return jsonb_build_object('error','INVALID_INPUT');end if;
  if jsonb_typeof(p_input->'name') is distinct from 'string' or jsonb_typeof(p_input->'username') is distinct from 'string'
   or (p_input ? 'website' and jsonb_typeof(p_input->'website')<>'string') or (p_input ? 'notes' and jsonb_typeof(p_input->'notes')<>'string')
   or length(trim(p_input->>'name')) not between 1 and 150 or length(trim(p_input->>'username')) not between 1 and 150
   or length(coalesce(p_input->>'website',''))>2048 or length(coalesce(p_input->>'notes',''))>1000
   or (coalesce(p_input->>'website','')<>'' and (p_input->>'website' !~ '^https://[^/@[:space:]]+([/?#]|$)' or p_input->>'website' ~ '^https://[^/]*@'))
   then return jsonb_build_object('error','INVALID_INPUT');end if;
  if p_account_id is null then
   insert into public.vault_accounts(hotel_id,department_id,name,username,website,notes,created_by,updated_by)
   values(p_hotel_id,p_department_id,trim(p_input->>'name'),trim(p_input->>'username'),trim(coalesce(p_input->>'website','')),trim(coalesce(p_input->>'notes','')),auth.uid(),auth.uid()) returning * into account;
  else
   update public.vault_accounts set department_id=p_department_id,name=trim(p_input->>'name'),username=trim(p_input->>'username'),website=trim(coalesce(p_input->>'website','')),notes=trim(coalesce(p_input->>'notes','')),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
   where id=p_account_id returning * into account;
  end if;
 else
  if p_account_id is null then return jsonb_build_object('error','INVALID_INPUT');end if;
  update public.vault_accounts set status=case when p_action='archive' then 'archived' else 'active' end,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_account_id returning * into account;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,account.id,'vault.metadata.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('id',account.id,'version',account.version));
end$$;

-- Exact email sharing avoids exposing an enumerable staff directory.
create or replace function public.vault_set_share(p_hotel_id uuid,p_account_id uuid,p_email text,p_expected_version integer,p_action text default 'grant')
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; recipient uuid;
begin
 select * into account from public.vault_accounts where id=p_account_id and hotel_id=p_hotel_id for update;
 if not found or account.owner_id<>auth.uid() or not workstel_private.account_allowed(p_account_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_account_id,'vault.share','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('grant','revoke') or p_email is null or length(trim(p_email)) not between 3 and 254 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_expected_version is null or account.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 select u.id into recipient from auth.users u where lower(u.email)=lower(trim(p_email))
 and (p_action='revoke' or exists(select 1 from workstel_private.staff_access a where a.user_id=u.id and a.hotel_id=p_hotel_id and a.enabled and a.can_read));
 if recipient is null or recipient=auth.uid() then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'vault.share','denied');
  return jsonb_build_object('error','RECIPIENT_UNAVAILABLE');
 end if;
 if p_action='grant' then
  if not exists(select 1 from workstel_private.vault_shares where account_id=p_account_id and recipient_id=recipient) and (select count(*) from workstel_private.vault_shares where account_id=p_account_id)>=50 then return jsonb_build_object('error','INVALID_INPUT');end if;
  insert into workstel_private.vault_shares(account_id,recipient_id,granted_by) values(p_account_id,recipient,auth.uid()) on conflict do nothing;
 else
  delete from workstel_private.vault_shares where account_id=p_account_id and recipient_id=recipient;
 end if;
 update public.vault_accounts set version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_account_id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,target_user_id)
 values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'vault.share.'||p_action,'success',recipient);
 return jsonb_build_object('data',jsonb_build_object('version',account.version+1));
end$$;
create or replace function public.vault_list_shares(p_hotel_id uuid,p_account_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.vault_accounts; result jsonb;
begin
 select * into account from public.vault_accounts where id=p_account_id and hotel_id=p_hotel_id;
 if not found or account.owner_id<>auth.uid() or not workstel_private.account_allowed(p_account_id,'read') then
  insert into workstel_private.audit_events(actor_id,hotel_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_account_id,'vault.share.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('email',u.email,'grantedAt',s.granted_at) order by s.granted_at),'[]'::jsonb) into result
 from workstel_private.vault_shares s join auth.users u on u.id=s.recipient_id where s.account_id=p_account_id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'vault.share.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('version',account.version));
end$$;
revoke all on function public.vault_set_share(uuid,uuid,text,integer,text) from public,anon;
revoke all on function public.vault_list_shares(uuid,uuid) from public,anon;
grant execute on function public.vault_set_share(uuid,uuid,text,integer,text) to authenticated;
grant execute on function public.vault_list_shares(uuid,uuid) to authenticated;
create or replace function public.workstel_session()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; scope_id uuid;
begin
 if auth.uid() is null then return jsonb_build_object('error','UNAUTHENTICATED');end if;
 select coalesce(jsonb_agg(jsonb_build_object('hotelId',a.hotel_id,'hotelName',h.name,'departmentId',a.department_id,'departmentCode',d.code,'departmentName',d.name,'canRead',a.can_read,'canWrite',a.can_write,'canArchive',a.can_archive,'canAudit',a.can_audit) order by h.name,d.code),'[]'::jsonb)
 into result from workstel_private.staff_access a join public.workstel_hotels h on h.id=a.hotel_id join public.workstel_departments d on d.id=a.department_id and d.hotel_id=a.hotel_id where a.user_id=auth.uid() and a.enabled;
 if jsonb_array_length(result)=0 then
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'session.access','denied');
 else
  for scope_id in select distinct a.hotel_id from workstel_private.staff_access a where a.user_id=auth.uid() and a.enabled loop
   insert into workstel_private.audit_events(actor_id,hotel_id,action,outcome) values(auth.uid(),scope_id,'session.access','success');
  end loop;
 end if;
 return jsonb_build_object('data',result,'meta',jsonb_build_object('vaultPolicy','private-v1'));
end$$;
insert into workstel_private.schema_migrations(version) values ('202611010003') on conflict do nothing;
notify pgrst,'reload schema';
commit;
