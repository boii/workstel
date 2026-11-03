begin;
-- A per-module switch enforced on the server: a disabled module denies every module RPC,
-- disappears from workstel_module_access and keeps all of its data and grants for re-enabling.
alter table workstel_private.installed_modules
 add column enabled boolean not null default true,
 add column updated_at timestamptz,
 add column updated_by uuid references auth.users(id);

-- Platform developers may switch modules. Membership is granted only by an operator.
create table workstel_private.platform_admins(
 user_id uuid primary key references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table workstel_private.platform_admins enable row level security;
revoke all on workstel_private.platform_admins from public,anon,authenticated;

create function workstel_private.audit_platform_admins()
returns trigger language plpgsql security definer set search_path='' as $$
declare target workstel_private.platform_admins;
begin
 if tg_op='DELETE' then target:=old;else target:=new;end if;
 insert into workstel_private.audit_events(actor_id,resource_id,action,outcome)
 values(auth.uid(),target.user_id,'platform.admin.'||lower(tg_op),'success');
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function workstel_private.audit_platform_admins() from public,anon,authenticated;
create trigger audit_platform_admins after insert or update or delete on workstel_private.platform_admins
 for each row execute function workstel_private.audit_platform_admins();

create function workstel_private.is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from workstel_private.platform_admins a where a.user_id=auth.uid()) $$;
revoke all on function workstel_private.is_platform_admin() from public,anon,authenticated;

-- Every Vehicle Checklist and Bin Card RPC checks access here, so the switch covers them all.
create or replace function workstel_private.module_allowed(p_module text,p_hotel uuid,p_department uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from workstel_private.module_access m
 join workstel_private.staff_access s on s.user_id=m.user_id and s.hotel_id=m.hotel_id and s.department_id=m.department_id and s.enabled
 join workstel_private.installed_modules i on i.module_id=m.module_id and i.enabled
 where m.user_id=auth.uid() and m.enabled and m.module_id=p_module and m.hotel_id=p_hotel and m.department_id=p_department
 and case p_permission when 'read' then m.can_read when 'write' then m.can_write when 'manage' then m.can_manage else false end) $$;

-- Only enabled modules are reported; platformAdmin tells the frontend to show module switches.
create or replace function public.workstel_module_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; installed jsonb;
begin
 if auth.uid() is null then return jsonb_build_object('error','UNAUTHENTICATED');end if;
 select coalesce(jsonb_agg(i.module_id order by i.module_id),'[]'::jsonb) into installed from workstel_private.installed_modules i where i.enabled;
 select coalesce(jsonb_agg(jsonb_build_object('moduleId',m.module_id,'hotelId',m.hotel_id,'hotelName',h.name,'departmentId',m.department_id,'departmentCode',d.code,'departmentName',d.name,'canRead',m.can_read,'canWrite',m.can_write,'canManage',m.can_manage) order by m.module_id,h.name,d.name),'[]'::jsonb)
 into result from workstel_private.module_access m
 join workstel_private.staff_access s on s.user_id=m.user_id and s.hotel_id=m.hotel_id and s.department_id=m.department_id and s.enabled
 join workstel_private.installed_modules i on i.module_id=m.module_id and i.enabled
 join public.workstel_hotels h on h.id=m.hotel_id
 join public.workstel_departments d on d.id=m.department_id and d.hotel_id=m.hotel_id
 where m.user_id=auth.uid() and m.enabled and m.can_read;
 return jsonb_build_object('data',result,'meta',jsonb_build_object('installedModules',installed,'platformAdmin',workstel_private.is_platform_admin()));
end$$;

create function public.workstel_list_modules()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'platform.module.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('moduleId',i.module_id,'schemaVersion',i.schema_version,'enabled',i.enabled,'installedAt',i.installed_at,'updatedAt',i.updated_at,'updatedByEmail',u.email) order by i.module_id),'[]'::jsonb)
 into result from workstel_private.installed_modules i left join auth.users u on u.id=i.updated_by;
 return jsonb_build_object('data',result);
end$$;

create function public.workstel_set_module_enabled(p_module_id text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target workstel_private.installed_modules;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'platform.module.switch','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_module_id is null or p_enabled is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into target from workstel_private.installed_modules where module_id=p_module_id for update;
 if not found then return jsonb_build_object('error','MODULE_NOT_INSTALLED');end if;
 if target.enabled<>p_enabled then
  update workstel_private.installed_modules set enabled=p_enabled,updated_at=clock_timestamp(),updated_by=auth.uid()
  where module_id=p_module_id returning * into target;
  -- The module ID is part of the action because audit resources are UUIDs.
  insert into workstel_private.audit_events(actor_id,action,outcome)
  values(auth.uid(),'platform.module.'||p_module_id||'.'||case when p_enabled then 'enable' else 'disable' end,'success');
 end if;
 return jsonb_build_object('data',jsonb_build_object('moduleId',target.module_id,'enabled',target.enabled));
end$$;
revoke all on function public.workstel_list_modules() from public,anon;
revoke all on function public.workstel_set_module_enabled(text,boolean) from public,anon;
grant execute on function public.workstel_list_modules() to authenticated;
grant execute on function public.workstel_set_module_enabled(text,boolean) to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611040006') on conflict do nothing;
notify pgrst,'reload schema';
commit;
