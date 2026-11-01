begin;
-- Additive release: retain existing accounts and append-only audit records.
do $$ begin
 if to_regclass('workstel_private.staff_access') is null then
  raise exception 'Apply the initial Workstel metadata migration first';
 end if;
end $$;
create table if not exists workstel_private.schema_migrations(version text primary key, applied_at timestamptz not null default clock_timestamp());
revoke all on workstel_private.schema_migrations from public,anon,authenticated;
create index if not exists workstel_audit_scope_time_idx on workstel_private.audit_events(hotel_id,department_id,occurred_at desc,id desc);

create or replace function public.vault_list_audit(p_hotel_id uuid,p_department_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; hotel_auditor boolean;
begin
 if not exists(select 1 from workstel_private.staff_access a where a.user_id=auth.uid() and a.enabled and a.can_audit and a.hotel_id=p_hotel_id and (p_department_id is null or a.department_id=p_department_id)) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'audit.read','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 -- Hotel-wide events are visible only when every department is explicitly auditable.
 select not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and not workstel_private.allowed(p_hotel_id,d.id,'audit')) into hotel_auditor;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.occurred_at desc,row_data.id desc),'[]'::jsonb) into result from (
  select e.id,e.actor_id,e.actor_database_role,e.hotel_id,e.department_id,e.resource_id,e.action,e.outcome,e.occurred_at,e.correlation_id
  from workstel_private.audit_events e where e.hotel_id=p_hotel_id
  and (workstel_private.allowed(e.hotel_id,e.department_id,'audit') or (e.department_id is null and hotel_auditor))
  and (p_department_id is null or e.department_id=p_department_id)
  order by e.occurred_at desc,e.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'audit.read','success');
 return jsonb_build_object('data',result);
end$$;

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
 return jsonb_build_object('data',result);
end$$;
insert into workstel_private.schema_migrations(version) values ('202611010001'),('202611010002') on conflict do nothing;
notify pgrst,'reload schema';
commit;
