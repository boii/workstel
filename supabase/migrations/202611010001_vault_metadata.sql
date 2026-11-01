begin;
create schema if not exists workstel_private;
revoke all on schema workstel_private from public,anon,authenticated;

create table public.workstel_hotels(
 id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 150)
);
create table public.workstel_departments(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null references public.workstel_hotels(id),
 code text not null check(code in ('front-office','sales','engineering','it')),name text not null,
 unique(hotel_id,code),unique(hotel_id,id)
);
create table workstel_private.staff_access(
 user_id uuid not null references auth.users(id),hotel_id uuid not null,
 department_id uuid not null,can_read boolean not null default false,
 can_write boolean not null default false,can_archive boolean not null default false,
 can_audit boolean not null default false,enabled boolean not null default true,
 primary key(user_id,hotel_id,department_id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create table public.vault_accounts(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,
 department_id uuid not null,name text not null check(length(trim(name)) between 1 and 150),
 username text not null check(length(trim(username)) between 1 and 150),
 website text not null default '' check(length(website)<=2048),notes text not null default '' check(length(notes)<=1000),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index vault_accounts_scope_idx on public.vault_accounts(hotel_id,department_id,status,id);
create table workstel_private.audit_events(
 id uuid primary key default gen_random_uuid(),actor_id uuid,hotel_id uuid,department_id uuid,
 resource_id uuid,action text not null,outcome text not null check(outcome in ('success','denied')),
 occurred_at timestamptz not null default clock_timestamp(),correlation_id uuid not null default gen_random_uuid()
);
alter table public.workstel_hotels enable row level security;
alter table public.workstel_departments enable row level security;
alter table public.vault_accounts enable row level security;
alter table workstel_private.staff_access enable row level security;
alter table workstel_private.audit_events enable row level security;
revoke all on public.workstel_hotels,public.workstel_departments,public.vault_accounts from public,anon,authenticated;
revoke all on all tables in schema workstel_private from public,anon,authenticated;

create function workstel_private.allowed(p_hotel uuid,p_department uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from workstel_private.staff_access a
 where a.user_id=auth.uid() and a.enabled and a.hotel_id=p_hotel and a.department_id=p_department
 and case p_permission when 'read' then a.can_read when 'write' then a.can_write when 'archive' then a.can_archive when 'audit' then a.can_audit else false end) $$;
revoke all on function workstel_private.allowed(uuid,uuid,text) from public,anon,authenticated;

create function workstel_private.reject_audit_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'Audit records are append-only';end$$;
create trigger audit_no_update_delete before update or delete on workstel_private.audit_events
 for each row execute function workstel_private.reject_audit_change();
create trigger audit_no_truncate before truncate on workstel_private.audit_events
 for each statement execute function workstel_private.reject_audit_change();

create function public.workstel_session()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then return jsonb_build_object('error','UNAUTHENTICATED');end if;
 select coalesce(jsonb_agg(jsonb_build_object('hotelId',a.hotel_id,'hotelName',h.name,'departmentId',a.department_id,'departmentCode',d.code,'departmentName',d.name,'canRead',a.can_read,'canWrite',a.can_write,'canArchive',a.can_archive,'canAudit',a.can_audit)),'[]'::jsonb)
 into result from workstel_private.staff_access a join public.workstel_hotels h on h.id=a.hotel_id
 join public.workstel_departments d on d.id=a.department_id and d.hotel_id=a.hotel_id
 where a.user_id=auth.uid() and a.enabled;
 insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'session.access',case when jsonb_array_length(result)>0 then 'success' else 'denied' end);
 return jsonb_build_object('data',result);
end$$;

create function public.vault_list_accounts(p_hotel_id uuid,p_department_id uuid default null,p_status text default 'active',p_search text default '',p_after uuid default null,p_limit integer default 50)
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
 select v.id,v.hotel_id,v.department_id,d.code as department_code,v.name,v.username,v.website,v.notes,v.status,v.version,v.created_at,v.updated_at,v.created_by,v.updated_by
 from public.vault_accounts v join public.workstel_departments d on d.hotel_id=v.hotel_id and d.id=v.department_id
 where v.hotel_id=p_hotel_id and workstel_private.allowed(v.hotel_id,v.department_id,'read')
 and (p_department_id is null or v.department_id=p_department_id)
 and (p_status='all' or v.status=p_status)
 and (p_after is null or v.id>p_after)
 and (p_search='' or v.name ilike '%'||p_search||'%' or v.username ilike '%'||p_search||'%' or v.website ilike '%'||p_search||'%')
 order by v.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vault.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

create function public.vault_write_metadata(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_account_id uuid default null,p_expected_version integer default null,p_action text default 'save')
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
  if not found or not workstel_private.allowed(existing.hotel_id,existing.department_id,required_permission) then
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
revoke all on function public.workstel_session() from public,anon;
revoke all on function public.vault_list_accounts(uuid,uuid,text,text,uuid,integer) from public,anon;
revoke all on function public.vault_write_metadata(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
grant execute on function public.workstel_session() to authenticated;
grant execute on function public.vault_list_accounts(uuid,uuid,text,text,uuid,integer) to authenticated;
grant execute on function public.vault_write_metadata(uuid,uuid,jsonb,uuid,integer,text) to authenticated;

-- Administrative membership changes are audited too; use named operator DB accounts.
alter table workstel_private.audit_events add column actor_database_role text not null default session_user;
create function workstel_private.audit_staff_access()
returns trigger language plpgsql security definer set search_path='' as $$
declare target workstel_private.staff_access;
begin
 if tg_op='DELETE' then target:=old;else target:=new;end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome)
 values(auth.uid(),target.hotel_id,target.department_id,target.user_id,'staff.access.'||lower(tg_op),'success');
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function workstel_private.audit_staff_access() from public,anon,authenticated;
create trigger audit_staff_access after insert or update or delete on workstel_private.staff_access
 for each row execute function workstel_private.audit_staff_access();

create function public.vault_list_audit(p_hotel_id uuid,p_department_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from workstel_private.staff_access a where a.user_id=auth.uid() and a.enabled and a.can_audit and a.hotel_id=p_hotel_id and (p_department_id is null or a.department_id=p_department_id)) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'audit.read','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.occurred_at desc,row_data.id desc),'[]'::jsonb) into result from (
 select e.id,e.actor_id,e.actor_database_role,e.hotel_id,e.department_id,e.resource_id,e.action,e.outcome,e.occurred_at,e.correlation_id
 from workstel_private.audit_events e where e.hotel_id=p_hotel_id
 and workstel_private.allowed(e.hotel_id,e.department_id,'audit')
 and (p_department_id is null or e.department_id=p_department_id)
 order by e.occurred_at desc,e.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'audit.read','success');
 return jsonb_build_object('data',result);
end$$;
revoke all on function public.vault_list_audit(uuid,uuid,integer) from public,anon;
grant execute on function public.vault_list_audit(uuid,uuid,integer) to authenticated;

commit;
