begin;
-- Vehicle Checklist: hotel vehicles per department and append-only inspection records.
create table public.vehicle_units(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 100),
 plate_number text not null check(plate_number ~ '^[A-Z0-9][A-Z0-9 -]{0,19}$'),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 last_inspected_at timestamptz,last_result text check(last_result in ('pass','attention')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create unique index vehicle_units_plate_idx on public.vehicle_units(hotel_id,plate_number);
create index vehicle_units_scope_idx on public.vehicle_units(hotel_id,department_id,status,lower(name),id);
create table public.vehicle_inspections(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 vehicle_id uuid not null references public.vehicle_units(id),
 inspected_at timestamptz not null default clock_timestamp(),inspected_by uuid not null references auth.users(id),
 odometer_km integer check(odometer_km between 0 and 9999999),
 fuel_level text not null check(fuel_level in ('empty','quarter','half','three-quarters','full')),
 items jsonb not null,result text not null check(result in ('pass','attention')),
 notes text not null default '' check(length(notes)<=1000),
 idempotency_key uuid not null,unique(inspected_by,idempotency_key),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index vehicle_inspections_scope_idx on public.vehicle_inspections(hotel_id,vehicle_id,inspected_at desc,id desc);
alter table public.vehicle_units enable row level security;
alter table public.vehicle_inspections enable row level security;
revoke all on public.vehicle_units,public.vehicle_inspections from public,anon,authenticated;

create function workstel_private.reject_inspection_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'Vehicle inspections are append-only';end$$;
create trigger vehicle_inspections_append_only before update or delete on public.vehicle_inspections
 for each row execute function workstel_private.reject_inspection_change();

-- Every checklist key must be answered exactly once with ok or issue.
create function workstel_private.vehicle_items_valid(p_items jsonb)
returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p_items)='object'
 and (select count(*) from jsonb_object_keys(p_items))=10
 and not exists(select 1 from jsonb_each(p_items) e
  where e.key not in ('exterior','tires','lights','brakes','wipers','horn','interior','air-conditioning','documents','safety-kit')
  or e.value not in ('"ok"'::jsonb,'"issue"'::jsonb)) $$;
revoke all on function workstel_private.vehicle_items_valid(jsonb) from public,anon,authenticated;

create function public.vehicle_list_units(p_hotel_id uuid,p_department_id uuid default null,p_status text default 'active',p_search text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; after_name text;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('vehicle',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vehicle.unit.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_status is null or p_status not in ('active','archived','all') or p_limit is null or p_limit<1 or p_limit>100 or p_search is null or length(p_search)>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select lower(name) into after_name from public.vehicle_units where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by lower(row_data.name),row_data.id),'[]'::jsonb) into result from (
  select v.id,v.hotel_id,v.department_id,d.code as department_code,d.name as department_name,v.name,v.plate_number,v.status,v.version,v.last_inspected_at,v.last_result,v.created_at,v.updated_at
  from public.vehicle_units v join public.workstel_departments d on d.hotel_id=v.hotel_id and d.id=v.department_id
  where v.hotel_id=p_hotel_id and workstel_private.module_allowed('vehicle',v.hotel_id,v.department_id,'read')
  and (p_department_id is null or v.department_id=p_department_id)
  and (p_status='all' or v.status=p_status)
  and (p_search='' or position(lower(p_search) in lower(v.name||' '||v.plate_number))>0)
  and (after_name is null or (lower(v.name),v.id)>(after_name,p_after))
  order by lower(v.name),v.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'vehicle.unit.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

create function public.vehicle_save_unit(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_unit_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.vehicle_units; existing public.vehicle_units; plate text;
begin
 if not workstel_private.module_allowed('vehicle',p_hotel_id,p_department_id,'manage') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_unit_id,'vehicle.unit.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_unit_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_unit_id is not null then
  select * into existing from public.vehicle_units where id=p_unit_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.module_allowed('vehicle',existing.hotel_id,existing.department_id,'manage') then
   insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_unit_id,'vehicle.unit.write','denied');
   return jsonb_build_object('error','ACCESS_DENIED');
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','plateNumber'))
   or jsonb_typeof(p_input->'name') is distinct from 'string' or jsonb_typeof(p_input->'plateNumber') is distinct from 'string'
   or length(trim(p_input->>'name')) not between 1 and 100 then return jsonb_build_object('error','INVALID_INPUT');end if;
  -- Plates are stored in one canonical form so duplicates cannot differ only by case or spacing.
  plate:=upper(regexp_replace(trim(p_input->>'plateNumber'),'\s+',' ','g'));
  if plate !~ '^[A-Z0-9][A-Z0-9 -]{0,19}$' then return jsonb_build_object('error','INVALID_INPUT');end if;
  begin
   if p_unit_id is null then
    insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
    values(p_hotel_id,p_department_id,trim(p_input->>'name'),plate,auth.uid(),auth.uid()) returning * into unit;
   else
    update public.vehicle_units set department_id=p_department_id,name=trim(p_input->>'name'),plate_number=plate,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where id=p_unit_id returning * into unit;
   end if;
  exception when unique_violation then
   return jsonb_build_object('error','DUPLICATE_PLATE');
  end;
 else
  update public.vehicle_units set status=case when p_action='archive' then 'archived' else 'active' end,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_unit_id returning * into unit;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,unit.department_id,unit.id,'vehicle.unit.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('id',unit.id,'version',unit.version));
end$$;

create function public.vehicle_record_inspection(p_hotel_id uuid,p_vehicle_id uuid,p_input jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.vehicle_units; inspection public.vehicle_inspections; outcome text; odometer integer;
begin
 select * into unit from public.vehicle_units where id=p_vehicle_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('vehicle',unit.hotel_id,unit.department_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,unit.department_id,p_vehicle_id,'vehicle.inspection.create','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_idempotency_key is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 -- A retried submission returns the original record instead of creating a duplicate.
 select * into inspection from public.vehicle_inspections where inspected_by=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if inspection.vehicle_id<>p_vehicle_id then return jsonb_build_object('error','INVALID_INPUT');end if;
  return jsonb_build_object('data',jsonb_build_object('id',inspection.id,'result',inspection.result,'inspectedAt',inspection.inspected_at));
 end if;
 if unit.status<>'active' then return jsonb_build_object('error','VEHICLE_ARCHIVED');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('odometerKm','fuelLevel','items','notes'))
  or not (p_input ? 'fuelLevel' and p_input ? 'items')
  or jsonb_typeof(p_input->'fuelLevel') is distinct from 'string'
  or p_input->>'fuelLevel' not in ('empty','quarter','half','three-quarters','full')
  or not workstel_private.vehicle_items_valid(p_input->'items')
  or (p_input ? 'notes' and (jsonb_typeof(p_input->'notes')<>'string' or length(p_input->>'notes')>1000))
  or (p_input ? 'odometerKm' and jsonb_typeof(p_input->'odometerKm') not in ('number','null'))
  or (jsonb_typeof(p_input->'odometerKm')='number' and (p_input->>'odometerKm' !~ '^[0-9]{1,7}$'))
  then return jsonb_build_object('error','INVALID_INPUT');end if;
 odometer:=case when jsonb_typeof(p_input->'odometerKm')='number' then (p_input->>'odometerKm')::integer else null end;
 outcome:=case when exists(select 1 from jsonb_each_text(p_input->'items') e where e.value='issue') then 'attention' else 'pass' end;
 -- Reported issues need a description so the next shift knows what to fix.
 if outcome='attention' and trim(coalesce(p_input->>'notes',''))='' then return jsonb_build_object('error','NOTES_REQUIRED');end if;
 insert into public.vehicle_inspections(hotel_id,department_id,vehicle_id,inspected_by,odometer_km,fuel_level,items,result,notes,idempotency_key)
 values(unit.hotel_id,unit.department_id,unit.id,auth.uid(),odometer,p_input->>'fuelLevel',p_input->'items',outcome,trim(coalesce(p_input->>'notes','')),p_idempotency_key)
 returning * into inspection;
 -- The latest result is a read-model field; it does not change the unit's edit version.
 update public.vehicle_units set last_inspected_at=inspection.inspected_at,last_result=outcome where id=unit.id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),unit.hotel_id,unit.department_id,inspection.id,'vehicle.inspection.create','success');
 return jsonb_build_object('data',jsonb_build_object('id',inspection.id,'result',inspection.result,'inspectedAt',inspection.inspected_at));
end$$;

create function public.vehicle_list_inspections(p_hotel_id uuid,p_vehicle_id uuid,p_before uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.vehicle_units; result jsonb; before_at timestamptz;
begin
 select * into unit from public.vehicle_units where id=p_vehicle_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('vehicle',unit.hotel_id,unit.department_id,'read') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,unit.department_id,p_vehicle_id,'vehicle.inspection.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_limit is null or p_limit<1 or p_limit>50 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_before is not null then select inspected_at into before_at from public.vehicle_inspections where id=p_before and vehicle_id=p_vehicle_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.inspected_at desc,row_data.id desc),'[]'::jsonb) into result from (
  select i.id,i.vehicle_id,i.inspected_at,i.inspected_by,u.email as inspector_email,i.odometer_km,i.fuel_level,i.items,i.result,i.notes
  from public.vehicle_inspections i left join auth.users u on u.id=i.inspected_by
  where i.vehicle_id=p_vehicle_id and (before_at is null or (i.inspected_at,i.id)<(before_at,p_before))
  order by i.inspected_at desc,i.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),unit.hotel_id,unit.department_id,unit.id,'vehicle.inspection.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

revoke all on function public.vehicle_list_units(uuid,uuid,text,text,uuid,integer) from public,anon;
revoke all on function public.vehicle_save_unit(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.vehicle_record_inspection(uuid,uuid,jsonb,uuid) from public,anon;
revoke all on function public.vehicle_list_inspections(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.vehicle_list_units(uuid,uuid,text,text,uuid,integer) to authenticated;
grant execute on function public.vehicle_save_unit(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.vehicle_record_inspection(uuid,uuid,jsonb,uuid) to authenticated;
grant execute on function public.vehicle_list_inspections(uuid,uuid,uuid,integer) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('vehicle',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611040002') on conflict do nothing;
notify pgrst,'reload schema';
commit;
