begin;
-- Vault audit access never grants access to platform or other module events.
create or replace function public.vault_list_audit(p_hotel_id uuid,p_department_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; hotel_auditor boolean;
begin
 if not exists(select 1 from workstel_private.staff_access a where a.user_id=auth.uid() and a.enabled and a.can_audit and a.hotel_id=p_hotel_id and (p_department_id is null or a.department_id=p_department_id)) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vault.audit.read','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 -- Hotel-wide events are visible only when every department is explicitly auditable.
 select not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and not workstel_private.allowed(p_hotel_id,d.id,'audit')) into hotel_auditor;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.occurred_at desc,row_data.id desc),'[]'::jsonb) into result from (
  select e.id,e.actor_id,e.actor_database_role,e.hotel_id,e.department_id,e.resource_id,e.action,e.outcome,e.occurred_at,e.correlation_id
  from workstel_private.audit_events e where e.hotel_id=p_hotel_id and e.action like 'vault.%'
  and (workstel_private.allowed(e.hotel_id,e.department_id,'audit') or (e.department_id is null and hotel_auditor))
  and (p_department_id is null or e.department_id=p_department_id)
  order by e.occurred_at desc,e.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vault.audit.read','success');
 return jsonb_build_object('data',result);
end$$;

insert into workstel_private.schema_migrations(version) values ('202611030001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
