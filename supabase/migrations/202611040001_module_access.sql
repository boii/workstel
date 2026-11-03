begin;
-- Operational modules use their own capabilities instead of the Vault-era department flags.
-- Module access applies only while the matching staff membership is enabled.
create table workstel_private.installed_modules(
 module_id text primary key check(module_id in ('vehicle','bin-card')),
 schema_version integer not null check(schema_version>0),
 installed_at timestamptz not null default clock_timestamp()
);
create table workstel_private.module_access(
 user_id uuid not null references auth.users(id),hotel_id uuid not null,department_id uuid not null,
 module_id text not null check(module_id in ('vehicle','bin-card')),
 can_read boolean not null default false,can_write boolean not null default false,
 can_manage boolean not null default false,enabled boolean not null default true,
 primary key(user_id,hotel_id,department_id,module_id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id),
 check(can_read or not (can_write or can_manage))
);
alter table workstel_private.installed_modules enable row level security;
alter table workstel_private.module_access enable row level security;
revoke all on workstel_private.installed_modules,workstel_private.module_access from public,anon,authenticated;

create function workstel_private.module_allowed(p_module text,p_hotel uuid,p_department uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from workstel_private.module_access m
 join workstel_private.staff_access s on s.user_id=m.user_id and s.hotel_id=m.hotel_id and s.department_id=m.department_id and s.enabled
 where m.user_id=auth.uid() and m.enabled and m.module_id=p_module and m.hotel_id=p_hotel and m.department_id=p_department
 and case p_permission when 'read' then m.can_read when 'write' then m.can_write when 'manage' then m.can_manage else false end) $$;
revoke all on function workstel_private.module_allowed(text,uuid,uuid,text) from public,anon,authenticated;

-- Capability grants are platform-owned events and stay out of module audit namespaces.
create function workstel_private.audit_module_access()
returns trigger language plpgsql security definer set search_path='' as $$
declare target workstel_private.module_access;
begin
 if tg_op='DELETE' then target:=old;else target:=new;end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome)
 values(auth.uid(),target.hotel_id,target.department_id,target.user_id,'staff.module-access.'||lower(tg_op),'success');
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function workstel_private.audit_module_access() from public,anon,authenticated;
create trigger audit_module_access after insert or update or delete on workstel_private.module_access
 for each row execute function workstel_private.audit_module_access();

-- The frontend opens a module only when it is installed here and the caller can read it.
create function public.workstel_module_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; installed jsonb;
begin
 if auth.uid() is null then return jsonb_build_object('error','UNAUTHENTICATED');end if;
 select coalesce(jsonb_agg(i.module_id order by i.module_id),'[]'::jsonb) into installed from workstel_private.installed_modules i;
 select coalesce(jsonb_agg(jsonb_build_object('moduleId',m.module_id,'hotelId',m.hotel_id,'hotelName',h.name,'departmentId',m.department_id,'departmentCode',d.code,'departmentName',d.name,'canRead',m.can_read,'canWrite',m.can_write,'canManage',m.can_manage) order by m.module_id,h.name,d.name),'[]'::jsonb)
 into result from workstel_private.module_access m
 join workstel_private.staff_access s on s.user_id=m.user_id and s.hotel_id=m.hotel_id and s.department_id=m.department_id and s.enabled
 join workstel_private.installed_modules i on i.module_id=m.module_id
 join public.workstel_hotels h on h.id=m.hotel_id
 join public.workstel_departments d on d.id=m.department_id and d.hotel_id=m.hotel_id
 where m.user_id=auth.uid() and m.enabled and m.can_read;
 return jsonb_build_object('data',result,'meta',jsonb_build_object('installedModules',installed));
end$$;
revoke all on function public.workstel_module_access() from public,anon;
grant execute on function public.workstel_module_access() to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611040001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
