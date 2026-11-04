begin;
-- User administration for platform developers. Account creation, password resets and login
-- blocks run in the workstel-users edge function with the service key; everything here is
-- callable only by developers (or by the service role for the server-side helpers).
create table workstel_private.user_flags(
 user_id uuid primary key references auth.users(id),
 must_change_password boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
alter table workstel_private.user_flags enable row level security;
revoke all on workstel_private.user_flags from public,anon,authenticated;

-- Sessions learn whether the signed-in user must replace a temporary password.
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
 return jsonb_build_object('data',result,'meta',jsonb_build_object(
  'installedModules',installed,
  'platformAdmin',workstel_private.is_platform_admin(),
  'mustChangePassword',coalesce((select f.must_change_password from workstel_private.user_flags f where f.user_id=auth.uid()),false)));
end$$;

create function public.workstel_admin_list_users()
returns jsonb language plpgsql security definer set search_path='' as $$
declare users jsonb; departments jsonb; modules jsonb;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'platform.user.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',u.id,'email',u.email,'createdAt',u.created_at,'lastSignInAt',u.last_sign_in_at,
   'blocked',coalesce(u.banned_until>now(),false),
   'developer',exists(select 1 from workstel_private.platform_admins a where a.user_id=u.id),
   'mustChangePassword',coalesce((select f.must_change_password from workstel_private.user_flags f where f.user_id=u.id),false),
   'memberships',coalesce((select jsonb_agg(jsonb_build_object('departmentId',s.department_id,'enabled',s.enabled,'canRead',s.can_read,'canWrite',s.can_write,'canArchive',s.can_archive,'canAudit',s.can_audit)) from workstel_private.staff_access s where s.user_id=u.id),'[]'::jsonb),
   'moduleGrants',coalesce((select jsonb_agg(jsonb_build_object('moduleId',m.module_id,'departmentId',m.department_id,'level',case when not m.enabled or not m.can_read then 'none' when m.can_manage then 'manage' when m.can_write then 'write' else 'read' end)) from workstel_private.module_access m where m.user_id=u.id),'[]'::jsonb)
  ) order by lower(u.email)),'[]'::jsonb)
 into users from (select * from auth.users order by lower(email) limit 500) u;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'hotelId',d.hotel_id,'hotelName',h.name,'code',d.code,'name',d.name) order by h.name,d.name),'[]'::jsonb)
 into departments from public.workstel_departments d join public.workstel_hotels h on h.id=d.hotel_id;
 select coalesce(jsonb_agg(i.module_id order by i.module_id),'[]'::jsonb) into modules from workstel_private.installed_modules i;
 -- Reading staff identities is sensitive, so successful reads are audited too.
 insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'platform.user.list','success');
 return jsonb_build_object('data',users,'meta',jsonb_build_object('departments',departments,'modules',modules));
end$$;

-- Department membership with the department-level (Vault) capabilities.
create function public.workstel_admin_set_membership(p_user_id uuid,p_department_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare department public.workstel_departments;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,department_id,resource_id,action,outcome) values(auth.uid(),p_department_id,p_user_id,'platform.user.membership','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select * into department from public.workstel_departments where id=p_department_id;
 if not found or not exists(select 1 from auth.users where id=p_user_id) then return jsonb_build_object('error','NOT_FOUND');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('enabled','canRead','canWrite','canArchive','canAudit'))
  or exists(select 1 from jsonb_each(p_input) e where jsonb_typeof(e.value)<>'boolean')
  or (select count(*) from jsonb_object_keys(p_input))<>5
  then return jsonb_build_object('error','INVALID_INPUT');end if;
 insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive,can_audit,enabled)
 values(p_user_id,department.hotel_id,department.id,(p_input->>'canRead')::boolean,(p_input->>'canWrite')::boolean,(p_input->>'canArchive')::boolean,(p_input->>'canAudit')::boolean,(p_input->>'enabled')::boolean)
 on conflict (user_id,hotel_id,department_id) do update set can_read=excluded.can_read,can_write=excluded.can_write,can_archive=excluded.can_archive,can_audit=excluded.can_audit,enabled=excluded.enabled
 where (workstel_private.staff_access.can_read,workstel_private.staff_access.can_write,workstel_private.staff_access.can_archive,workstel_private.staff_access.can_audit,workstel_private.staff_access.enabled)
  is distinct from (excluded.can_read,excluded.can_write,excluded.can_archive,excluded.can_audit,excluded.enabled);
 return jsonb_build_object('data',jsonb_build_object('userId',p_user_id,'departmentId',p_department_id));
end$$;

-- Module level per department: none removes the grant; read, write and manage are cumulative.
create function public.workstel_admin_set_module_level(p_user_id uuid,p_department_id uuid,p_module_id text,p_level text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare department public.workstel_departments;
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,department_id,resource_id,action,outcome) values(auth.uid(),p_department_id,p_user_id,'platform.user.module-level','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_level is null or p_level not in ('none','read','write','manage') then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into department from public.workstel_departments where id=p_department_id;
 if not found or not exists(select 1 from auth.users where id=p_user_id)
  or not exists(select 1 from workstel_private.installed_modules where module_id=p_module_id) then return jsonb_build_object('error','NOT_FOUND');end if;
 if p_level='none' then
  delete from workstel_private.module_access where user_id=p_user_id and department_id=p_department_id and hotel_id=department.hotel_id and module_id=p_module_id;
 else
  insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage)
  values(p_user_id,department.hotel_id,department.id,p_module_id,true,p_level in ('write','manage'),p_level='manage')
  on conflict (user_id,hotel_id,department_id,module_id) do update set can_read=true,can_write=excluded.can_write,can_manage=excluded.can_manage,enabled=true
  where (workstel_private.module_access.can_read,workstel_private.module_access.can_write,workstel_private.module_access.can_manage,workstel_private.module_access.enabled)
   is distinct from (true,excluded.can_write,excluded.can_manage,true);
 end if;
 return jsonb_build_object('data',jsonb_build_object('userId',p_user_id,'level',p_level));
end$$;

create function public.workstel_admin_set_developer(p_user_id uuid,p_developer boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not workstel_private.is_platform_admin() then
  insert into workstel_private.audit_events(actor_id,resource_id,action,outcome) values(auth.uid(),p_user_id,'platform.user.developer','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_developer is null or not exists(select 1 from auth.users where id=p_user_id) then return jsonb_build_object('error','NOT_FOUND');end if;
 -- A developer cannot remove their own role, so the platform always keeps someone in charge.
 if not p_developer and p_user_id=auth.uid() then return jsonb_build_object('error','SELF_LOCKOUT');end if;
 if p_developer then insert into workstel_private.platform_admins(user_id) values(p_user_id) on conflict do nothing;
 else delete from workstel_private.platform_admins where user_id=p_user_id;end if;
 return jsonb_build_object('data',jsonb_build_object('userId',p_user_id,'developer',p_developer));
end$$;

-- Server-side helpers for the workstel-users edge function (service role only).
create function public.workstel_user_admin_record(p_actor uuid,p_target uuid,p_action text,p_outcome text)
returns void language sql security definer set search_path='' as $$
 insert into workstel_private.audit_events(actor_id,resource_id,action,outcome)
 select p_actor,p_target,'platform.user.'||p_action,p_outcome
 where p_action in ('create','reset-password','block','unblock','password-change') and p_outcome in ('success','denied') $$;
create function public.workstel_user_admin_flag(p_user_id uuid,p_must_change boolean)
returns void language sql security definer set search_path='' as $$
 insert into workstel_private.user_flags(user_id,must_change_password) values(p_user_id,p_must_change)
 on conflict (user_id) do update set must_change_password=excluded.must_change_password,updated_at=clock_timestamp() $$;

revoke all on function public.workstel_admin_list_users() from public,anon;
revoke all on function public.workstel_admin_set_membership(uuid,uuid,jsonb) from public,anon;
revoke all on function public.workstel_admin_set_module_level(uuid,uuid,text,text) from public,anon;
revoke all on function public.workstel_admin_set_developer(uuid,boolean) from public,anon;
grant execute on function public.workstel_admin_list_users() to authenticated;
grant execute on function public.workstel_admin_set_membership(uuid,uuid,jsonb) to authenticated;
grant execute on function public.workstel_admin_set_module_level(uuid,uuid,text,text) to authenticated;
grant execute on function public.workstel_admin_set_developer(uuid,boolean) to authenticated;
revoke all on function public.workstel_user_admin_record(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.workstel_user_admin_flag(uuid,boolean) from public,anon,authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.workstel_user_admin_record(uuid,uuid,text,text) to service_role;
  grant execute on function public.workstel_user_admin_flag(uuid,boolean) to service_role;
 end if;
end $$;

insert into workstel_private.schema_migrations(version) values ('202611040007') on conflict do nothing;
notify pgrst,'reload schema';
commit;
