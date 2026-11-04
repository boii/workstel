begin;
-- Documents & SOPs: a per-department library of links to documents kept elsewhere
-- (for example Google Drive or SharePoint). Files are not stored by Workstel.
alter table workstel_private.installed_modules drop constraint installed_modules_module_id_check;
alter table workstel_private.installed_modules add constraint installed_modules_module_id_check
 check(module_id in ('vehicle','bin-card','documents'));
alter table workstel_private.module_access drop constraint module_access_module_id_check;
alter table workstel_private.module_access add constraint module_access_module_id_check
 check(module_id in ('vehicle','bin-card','documents'));

create table public.documents_links(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 150),
 category text not null check(category in ('sop','policy','form','guide','other')),
 url text not null check(length(url) between 9 and 2048 and url ~ '^https://[^/@[:space:]]+([/?#]|$)' and url !~ '^https://[^/]*@'),
 description text not null default '' check(length(description)<=500),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index documents_links_scope_idx on public.documents_links(hotel_id,department_id,status,lower(title),id);
alter table public.documents_links enable row level security;
revoke all on public.documents_links from public,anon,authenticated;

create function public.documents_list(p_hotel_id uuid,p_department_id uuid default null,p_status text default 'active',p_category text default null,p_search text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; after_title text;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('documents',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'documents.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_status is null or p_status not in ('active','archived','all') or (p_category is not null and p_category not in ('sop','policy','form','guide','other'))
  or p_limit is null or p_limit<1 or p_limit>100 or p_search is null or length(p_search)>150 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select lower(title) into after_title from public.documents_links where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by lower(row_data.title),row_data.id),'[]'::jsonb) into result from (
  select l.id,l.hotel_id,l.department_id,d.name as department_name,l.title,l.category,l.url,l.description,l.status,l.version,l.updated_at
  from public.documents_links l join public.workstel_departments d on d.hotel_id=l.hotel_id and d.id=l.department_id
  where l.hotel_id=p_hotel_id and workstel_private.module_allowed('documents',l.hotel_id,l.department_id,'read')
  and (p_department_id is null or l.department_id=p_department_id)
  and (p_status='all' or l.status=p_status)
  and (p_category is null or l.category=p_category)
  and (p_search='' or position(lower(p_search) in lower(l.title||' '||l.description))>0)
  and (after_title is null or (lower(l.title),l.id)>(after_title,p_after))
  order by lower(l.title),l.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'documents.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

-- write adds and edits links; manage also archives and restores them.
create function public.documents_save(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_document_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.documents_links; existing public.documents_links; permission text; address text;
begin
 permission:=case when p_action in ('archive','restore') then 'manage' else 'write' end;
 if not workstel_private.module_allowed('documents',p_hotel_id,p_department_id,permission) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_document_id,'documents.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_document_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_document_id is not null then
  select * into existing from public.documents_links where id=p_document_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.module_allowed('documents',existing.hotel_id,existing.department_id,permission) then
   insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_document_id,'documents.write','denied');
   return jsonb_build_object('error','ACCESS_DENIED');
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('title','category','url','description'))
   or exists(select 1 from jsonb_each(p_input) e where jsonb_typeof(e.value)<>'string')
   or not (p_input ? 'title' and p_input ? 'category' and p_input ? 'url')
   or length(trim(p_input->>'title')) not between 1 and 150
   or p_input->>'category' not in ('sop','policy','form','guide','other')
   or length(trim(coalesce(p_input->>'description','')))>500 then return jsonb_build_object('error','INVALID_INPUT');end if;
  address:=trim(p_input->>'url');
  if length(address) not between 9 and 2048 or address !~ '^https://[^/@[:space:]]+([/?#]|$)' or address ~ '^https://[^/]*@' then return jsonb_build_object('error','INVALID_URL');end if;
  if p_document_id is null then
   insert into public.documents_links(hotel_id,department_id,title,category,url,description,created_by,updated_by)
   values(p_hotel_id,p_department_id,trim(p_input->>'title'),p_input->>'category',address,trim(coalesce(p_input->>'description','')),auth.uid(),auth.uid()) returning * into link;
  else
   update public.documents_links set department_id=p_department_id,title=trim(p_input->>'title'),category=p_input->>'category',url=address,description=trim(coalesce(p_input->>'description','')),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
   where id=p_document_id returning * into link;
  end if;
 else
  update public.documents_links set status=case when p_action='archive' then 'archived' else 'active' end,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_document_id returning * into link;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,link.department_id,link.id,'documents.link.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('id',link.id,'version',link.version));
end$$;

revoke all on function public.documents_list(uuid,uuid,text,text,text,uuid,integer) from public,anon;
revoke all on function public.documents_save(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
grant execute on function public.documents_list(uuid,uuid,text,text,text,uuid,integer) to authenticated;
grant execute on function public.documents_save(uuid,uuid,jsonb,uuid,integer,text) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('documents',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611040009') on conflict do nothing;
notify pgrst,'reload schema';
commit;
