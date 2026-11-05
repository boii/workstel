begin;
-- Platform-owned audit reader. It returns only platform.* events (staff access, developer
-- grants, module switches, its own reads) and never Vault or other module events, which stay
-- behind each module's own scoped reader (docs/MODULE_STANDARD.md, module isolation).
create function public.workstel_admin_list_audit(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'platform.audit.read','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.occurred_at desc,row_data.id desc),'[]'::jsonb) into result from (
  select e.id,e.actor_id,e.actor_database_role,e.hotel_id,e.department_id,e.resource_id,e.action,e.outcome,e.occurred_at,e.correlation_id,
   h.name as hotel_name,d.name as department_name
  from workstel_private.audit_events e
  left join public.workstel_hotels h on h.id=e.hotel_id
  left join public.workstel_departments d on d.id=e.department_id
  where e.action like 'platform.%'
  order by e.occurred_at desc,e.id desc limit p_limit
 ) row_data;
 -- Audit readers record their own access.
 insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'platform.audit.read','success');
 return jsonb_build_object('data',result);
end$$;
revoke all on function public.workstel_admin_list_audit(integer) from public,anon;
grant execute on function public.workstel_admin_list_audit(integer) to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611050001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
