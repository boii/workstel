begin;
-- AC Care: an air-conditioner register per hotel department, a service schedule computed from
-- the last service of each kind, task claims so two technicians do not take the same job,
-- append-only service records with measured readings, and append-only complaints.
-- Service kinds nest: routine includes filter cleaning, major includes routine, annual includes
-- major. Recording a kind therefore resets the schedule of that kind and every smaller one.
alter table workstel_private.installed_modules drop constraint installed_modules_module_id_check;
alter table workstel_private.module_access drop constraint module_access_module_id_check;
alter table workstel_private.installed_modules add constraint installed_modules_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','room-turnaround','casual-attendance','ac-care'));
alter table workstel_private.module_access add constraint module_access_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','room-turnaround','casual-attendance','ac-care'));

create table public.ac_care_units(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 code text not null check(code ~ '^[A-Z0-9][A-Z0-9 ./-]{0,19}$'),
 location text not null check(length(trim(location)) between 1 and 80),
 area text not null default '' check(length(area)<=40),
 unit_type text not null default 'split' check(unit_type in ('split','cassette','standing','ceiling','vrf','fcu','ahu','other')),
 brand text not null default '' check(length(brand)<=40),
 capacity text not null default '' check(length(capacity)<=20),
 refrigerant text not null default 'r32' check(refrigerant in ('r32','r410a','r22','other')),
 rated_current numeric(5,1) check(rated_current is null or rated_current>0),
 installed_on date,warranty_until date,
 filter_days integer not null default 21 check(filter_days between 0 and 730),
 routine_days integer not null default 90 check(routine_days between 0 and 730),
 major_days integer not null default 180 check(major_days between 0 and 730),
 annual_days integer not null default 365 check(annual_days between 0 and 730),
 condition text not null default 'normal' check(condition in ('normal','attention','broken')),
 archived boolean not null default false,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 unique(hotel_id,department_id,id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create unique index ac_care_units_code_idx on public.ac_care_units(hotel_id,department_id,upper(code));

-- Technicians responsible for an area (the unit's free-text area, such as a floor).
create table public.ac_care_area_members(
 hotel_id uuid not null,department_id uuid not null,
 area text not null check(length(trim(area)) between 1 and 40),
 user_id uuid not null references auth.users(id),
 backup boolean not null default false,
 created_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 primary key(hotel_id,department_id,area,user_id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);

-- Who is doing a scheduled service now (claimed, expires after eight hours) or why it waits
-- (postponed, with a required note). At most one row per unit and service kind.
create table public.ac_care_work(
 unit_id uuid not null references public.ac_care_units(id),
 service_type text not null check(service_type in ('filter','routine','major','annual')),
 hotel_id uuid not null,department_id uuid not null,
 state text not null check(state in ('claimed','postponed')),
 user_id uuid not null references auth.users(id),
 note text not null default '' check(length(note)<=200),
 at timestamptz not null default clock_timestamp(),
 expires_at timestamptz,
 assigned_by uuid references auth.users(id),
 primary key(unit_id,service_type),
 check((state='claimed')=(expires_at is not null)),
 check(state<>'postponed' or length(trim(note))>0)
);

create table public.ac_care_services(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,unit_id uuid not null,
 service_type text not null check(service_type in ('filter','routine','major','annual')),
 done_by uuid not null references auth.users(id),
 done_at timestamptz not null default clock_timestamp(),
 items jsonb not null,
 return_temp numeric(4,1),supply_temp numeric(4,1),pressure_psi integer,current_amp numeric(5,1),
 refrigerant_added boolean not null default false,
 result text not null check(result in ('normal','attention')),
 reasons jsonb not null default '[]',
 notes text not null default '' check(length(notes)<=1000),
 idempotency_key uuid not null,unique(done_by,idempotency_key),
 foreign key(hotel_id,department_id,unit_id) references public.ac_care_units(hotel_id,department_id,id)
);
create index ac_care_services_unit_idx on public.ac_care_services(unit_id,done_at desc);

create table public.ac_care_complaints(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,unit_id uuid not null,
 kind text not null check(kind in ('not-cold','leak','noise','smell','not-on','other')),
 note text not null default '' check(length(note)<=500),
 reported_by uuid not null references auth.users(id),
 reported_at timestamptz not null default clock_timestamp(),
 idempotency_key uuid not null,unique(reported_by,idempotency_key),
 foreign key(hotel_id,department_id,unit_id) references public.ac_care_units(hotel_id,department_id,id)
);
create index ac_care_complaints_unit_idx on public.ac_care_complaints(unit_id,reported_at desc);

alter table public.ac_care_units enable row level security;
alter table public.ac_care_area_members enable row level security;
alter table public.ac_care_work enable row level security;
alter table public.ac_care_services enable row level security;
alter table public.ac_care_complaints enable row level security;
revoke all on public.ac_care_units,public.ac_care_area_members,public.ac_care_work,public.ac_care_services,public.ac_care_complaints
 from public,anon,authenticated;

create function workstel_private.reject_ac_care_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'AC Care service and complaint records are append-only';end$$;
create trigger ac_care_services_append_only before update or delete on public.ac_care_services
 for each row execute function workstel_private.reject_ac_care_change();
create trigger ac_care_complaints_append_only before update or delete on public.ac_care_complaints
 for each row execute function workstel_private.reject_ac_care_change();

create function workstel_private.ac_care_denied(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'denied');
 return jsonb_build_object('error','ACCESS_DENIED');
end$$;
create function workstel_private.ac_care_audit(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns void language sql security definer set search_path='' as $$
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'success') $$;

create function workstel_private.ac_care_rank(p_type text)
returns integer language sql immutable set search_path='' as $$
 select case p_type when 'filter' then 1 when 'routine' then 2 when 'major' then 3 when 'annual' then 4 else 0 end $$;

-- Checklist items each service kind requires; larger kinds include the smaller kinds' items.
create function workstel_private.ac_care_items(p_type text)
returns text[] language sql immutable set search_path='' as $$
 select case p_type
  when 'filter' then array['filter']
  when 'routine' then array['filter','evaporator','drain','noise']
  when 'major' then array['filter','evaporator','drain','noise','condenser','leak']
  when 'annual' then array['filter','evaporator','drain','noise','condenser','leak','electrical','mounting','insulation']
  else array[]::text[] end $$;

create function workstel_private.ac_care_interval(p_unit public.ac_care_units,p_type text)
returns integer language sql immutable set search_path='' as $$
 select case p_type when 'filter' then p_unit.filter_days when 'routine' then p_unit.routine_days
  when 'major' then p_unit.major_days when 'annual' then p_unit.annual_days else 0 end $$;

-- A technician is someone with an enabled AC Care write grant in the department.
create function workstel_private.ac_care_is_technician(p_user uuid,p_hotel uuid,p_department uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from workstel_private.module_access m
  join workstel_private.staff_access s on s.user_id=m.user_id and s.hotel_id=m.hotel_id and s.department_id=m.department_id and s.enabled
  where m.user_id=p_user and m.hotel_id=p_hotel and m.department_id=p_department and m.module_id='ac-care' and m.enabled and m.can_write) $$;

create function workstel_private.ac_care_email(p_user uuid)
returns text language sql stable security definer set search_path='' as $$
 select coalesce((select u.email from auth.users u where u.id=p_user),'') $$;

-- Validates a unit as sent by the form or the import. Only code and location are required.
create function workstel_private.ac_care_unit_input_valid(p_input jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare key text; value jsonb;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object' or not (p_input ? 'code') or not (p_input ? 'location') then return false;end if;
 for key,value in select * from jsonb_each(p_input) loop
  if key in ('code','location','area','unitType','brand','capacity','refrigerant','installedOn','warrantyUntil') then
   if jsonb_typeof(value)<>'string' then return false;end if;
  elsif key='ratedCurrent' then
   if not (jsonb_typeof(value)='null' or (jsonb_typeof(value)='number' and (value#>>'{}')::numeric between 0.1 and 999.9)) then return false;end if;
  elsif key in ('filterDays','routineDays','majorDays','annualDays') then
   if jsonb_typeof(value)<>'number' or (value#>>'{}')::numeric<>trunc((value#>>'{}')::numeric) or (value#>>'{}')::numeric not between 0 and 730 then return false;end if;
  else return false;
  end if;
 end loop;
 if upper(trim(p_input->>'code')) !~ '^[A-Z0-9][A-Z0-9 ./-]{0,19}$'
  or length(trim(p_input->>'location')) not between 1 and 80
  or length(trim(coalesce(p_input->>'area','')))>40
  or coalesce(p_input->>'unitType','split') not in ('split','cassette','standing','ceiling','vrf','fcu','ahu','other')
  or length(trim(coalesce(p_input->>'brand','')))>40
  or length(trim(coalesce(p_input->>'capacity','')))>20
  or coalesce(p_input->>'refrigerant','r32') not in ('r32','r410a','r22','other') then return false;end if;
 foreach key in array array['installedOn','warrantyUntil'] loop
  if coalesce(p_input->>key,'')<>'' then
   if p_input->>key !~ '^\d{4}-\d{2}-\d{2}$' then return false;end if;
   begin perform (p_input->>key)::date; exception when others then return false; end;
  end if;
 end loop;
 return true;
end$$;

-- Each scheduled kind with its due day (hotel calendar, Asia/Jakarta) and current claim or postponement.
-- A unit that was never serviced starts its schedule on the day it was registered.
create function workstel_private.ac_care_schedule(p_unit public.ac_care_units)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('type',s.t,'interval_days',s.days,'last_done_at',s.last_done,
   'due_on',(coalesce(s.last_done,p_unit.created_at) at time zone 'Asia/Jakarta')::date+s.days,
   'work',(select jsonb_build_object('state',w.state,'user_email',workstel_private.ac_care_email(w.user_id),'mine',w.user_id=auth.uid(),
      'note',w.note,'at',w.at,'expires_at',w.expires_at,'assigned',w.assigned_by is not null and w.assigned_by<>w.user_id)
     from public.ac_care_work w where w.unit_id=p_unit.id and w.service_type=s.t and (w.state='postponed' or w.expires_at>clock_timestamp())))
  order by s.rank),'[]'::jsonb)
 from (select v.t,v.rank,workstel_private.ac_care_interval(p_unit,v.t) as days,
   (select max(sv.done_at) from public.ac_care_services sv where sv.unit_id=p_unit.id and workstel_private.ac_care_rank(sv.service_type)>=v.rank) as last_done
  from (values ('filter',1),('routine',2),('major',3),('annual',4)) v(t,rank)) s
 where s.days>0 $$;

create function workstel_private.ac_care_unit_json(p_unit public.ac_care_units)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_unit.id,'hotel_id',p_unit.hotel_id,'department_id',p_unit.department_id,
  'department_name',(select d.name from public.workstel_departments d where d.id=p_unit.department_id),
  'code',p_unit.code,'location',p_unit.location,'area',p_unit.area,'unit_type',p_unit.unit_type,'brand',p_unit.brand,
  'capacity',p_unit.capacity,'refrigerant',p_unit.refrigerant,'rated_current',p_unit.rated_current,
  'installed_on',p_unit.installed_on,'warranty_until',p_unit.warranty_until,
  'filter_days',p_unit.filter_days,'routine_days',p_unit.routine_days,'major_days',p_unit.major_days,'annual_days',p_unit.annual_days,
  'condition',p_unit.condition,'archived',p_unit.archived,'version',p_unit.version,
  'area_mine',exists(select 1 from public.ac_care_area_members a where a.hotel_id=p_unit.hotel_id and a.department_id=p_unit.department_id
    and upper(a.area)=upper(p_unit.area) and a.user_id=auth.uid()),
  'complaints_60d',(select count(*) from public.ac_care_complaints c where c.unit_id=p_unit.id and c.reported_at>clock_timestamp()-interval '60 days'),
  'refills_90d',(select count(*) from public.ac_care_services sv where sv.unit_id=p_unit.id and sv.refrigerant_added and sv.done_at>clock_timestamp()-interval '90 days'),
  'last_service',(select jsonb_build_object('service_type',sv.service_type,'done_at',sv.done_at,'result',sv.result)
    from public.ac_care_services sv where sv.unit_id=p_unit.id order by sv.done_at desc limit 1),
  'schedule',workstel_private.ac_care_schedule(p_unit)) $$;

revoke all on function workstel_private.reject_ac_care_change(),workstel_private.ac_care_denied(uuid,uuid,uuid,text),
 workstel_private.ac_care_audit(uuid,uuid,uuid,text),workstel_private.ac_care_rank(text),workstel_private.ac_care_items(text),
 workstel_private.ac_care_interval(public.ac_care_units,text),workstel_private.ac_care_is_technician(uuid,uuid,uuid),
 workstel_private.ac_care_email(uuid),workstel_private.ac_care_unit_input_valid(jsonb),
 workstel_private.ac_care_schedule(public.ac_care_units),workstel_private.ac_care_unit_json(public.ac_care_units)
 from public,anon,authenticated;

-- Every unit the caller can read, with its schedule. At most 1000 units per call.
create function public.ac_care_units_list(p_hotel_id uuid,p_department_id uuid default null,p_include_archived boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('ac-care',p_hotel_id,d.id,'read')) then
  return workstel_private.ac_care_denied(p_hotel_id,p_department_id,null,'ac-care.units.list');
 end if;
 if p_include_archived is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(workstel_private.ac_care_unit_json(x.u) order by upper(x.area),upper(x.code)),'[]'::jsonb) into result from (
  select u,u.area,u.code from public.ac_care_units u
  where u.hotel_id=p_hotel_id and workstel_private.module_allowed('ac-care',u.hotel_id,u.department_id,'read')
  and (p_department_id is null or u.department_id=p_department_id) and (p_include_archived or not u.archived)
  order by upper(u.area),upper(u.code) limit 1000
 ) x;
 perform workstel_private.ac_care_audit(p_hotel_id,p_department_id,null,'ac-care.units.list');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('now',clock_timestamp(),
  'today',(clock_timestamp() at time zone 'Asia/Jakarta')::date));
end$$;

-- Supervisors (manage) add and edit units, archive or restore them and mark them broken or normal.
create function public.ac_care_unit_save(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_unit_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.ac_care_units; existing public.ac_care_units;
begin
 if not workstel_private.module_allowed('ac-care',p_hotel_id,p_department_id,'manage') then
  return workstel_private.ac_care_denied(p_hotel_id,p_department_id,p_unit_id,'ac-care.write');
 end if;
 if p_action is null or p_action not in ('save','archive','restore','broken','normal') or (p_action<>'save' and p_unit_id is null) then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 if p_unit_id is not null then
  select * into existing from public.ac_care_units where id=p_unit_id and hotel_id=p_hotel_id and department_id=p_department_id for update;
  if not found then return workstel_private.ac_care_denied(p_hotel_id,p_department_id,p_unit_id,'ac-care.write');end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if not workstel_private.ac_care_unit_input_valid(p_input) then return jsonb_build_object('error','INVALID_INPUT');end if;
  if exists(select 1 from public.ac_care_units u where u.hotel_id=p_hotel_id and u.department_id=p_department_id
   and upper(u.code)=upper(trim(p_input->>'code')) and u.id is distinct from p_unit_id) then return jsonb_build_object('error','DUPLICATE_CODE');end if;
  if p_unit_id is null then
   insert into public.ac_care_units(hotel_id,department_id,code,location,area,unit_type,brand,capacity,refrigerant,rated_current,installed_on,warranty_until,
    filter_days,routine_days,major_days,annual_days,created_by,updated_by)
   values(p_hotel_id,p_department_id,upper(trim(p_input->>'code')),trim(p_input->>'location'),trim(coalesce(p_input->>'area','')),
    coalesce(p_input->>'unitType','split'),trim(coalesce(p_input->>'brand','')),trim(coalesce(p_input->>'capacity','')),coalesce(p_input->>'refrigerant','r32'),
    (p_input->>'ratedCurrent')::numeric,nullif(p_input->>'installedOn','')::date,nullif(p_input->>'warrantyUntil','')::date,
    coalesce((p_input->>'filterDays')::integer,21),coalesce((p_input->>'routineDays')::integer,90),
    coalesce((p_input->>'majorDays')::integer,180),coalesce((p_input->>'annualDays')::integer,365),auth.uid(),auth.uid()) returning * into unit;
  else
   update public.ac_care_units set code=upper(trim(p_input->>'code')),location=trim(p_input->>'location'),area=trim(coalesce(p_input->>'area','')),
    unit_type=coalesce(p_input->>'unitType','split'),brand=trim(coalesce(p_input->>'brand','')),capacity=trim(coalesce(p_input->>'capacity','')),
    refrigerant=coalesce(p_input->>'refrigerant','r32'),rated_current=(p_input->>'ratedCurrent')::numeric,
    installed_on=nullif(p_input->>'installedOn','')::date,warranty_until=nullif(p_input->>'warrantyUntil','')::date,
    filter_days=coalesce((p_input->>'filterDays')::integer,21),routine_days=coalesce((p_input->>'routineDays')::integer,90),
    major_days=coalesce((p_input->>'majorDays')::integer,180),annual_days=coalesce((p_input->>'annualDays')::integer,365),
    version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_unit_id returning * into unit;
   -- Claims for kinds that are no longer scheduled would otherwise linger out of sight.
   delete from public.ac_care_work w where w.unit_id=unit.id and workstel_private.ac_care_interval(unit,w.service_type)=0;
  end if;
 elsif p_action in ('archive','restore') then
  update public.ac_care_units set archived=(p_action='archive'),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_unit_id returning * into unit;
  if p_action='archive' then delete from public.ac_care_work where unit_id=unit.id;end if;
 else
  update public.ac_care_units set condition=p_action,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_unit_id returning * into unit;
 end if;
 perform workstel_private.ac_care_audit(p_hotel_id,p_department_id,unit.id,'ac-care.unit.'||p_action);
 return jsonb_build_object('data',jsonb_build_object('id',unit.id,'version',unit.version));
end$$;

-- Adds up to 500 units at once (for example pasted from a spreadsheet); existing codes are skipped.
create function public.ac_care_units_import(p_hotel_id uuid,p_department_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if not workstel_private.module_allowed('ac-care',p_hotel_id,p_department_id,'manage') then
  return workstel_private.ac_care_denied(p_hotel_id,p_department_id,null,'ac-care.write');
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500
  or exists(select 1 from jsonb_array_elements(p_rows) e where not workstel_private.ac_care_unit_input_valid(e)) then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 with incoming as (
  select distinct on (upper(trim(e->>'code'))) e from jsonb_array_elements(p_rows) e
 ), inserted as (
  insert into public.ac_care_units(hotel_id,department_id,code,location,area,unit_type,brand,capacity,refrigerant,created_by,updated_by)
  select p_hotel_id,p_department_id,upper(trim(i.e->>'code')),trim(i.e->>'location'),trim(coalesce(i.e->>'area','')),coalesce(i.e->>'unitType','split'),
   trim(coalesce(i.e->>'brand','')),trim(coalesce(i.e->>'capacity','')),coalesce(i.e->>'refrigerant','r32'),auth.uid(),auth.uid()
  from incoming i
  where not exists(select 1 from public.ac_care_units u where u.hotel_id=p_hotel_id and u.department_id=p_department_id and upper(u.code)=upper(trim(i.e->>'code')))
  returning 1
 ) select count(*) into added from inserted;
 perform workstel_private.ac_care_audit(p_hotel_id,p_department_id,null,'ac-care.unit.import');
 return jsonb_build_object('data',jsonb_build_object('added',added,'skipped',jsonb_array_length(p_rows)-added));
end$$;

-- claim: take a scheduled service for eight hours. release: drop one's own claim or
-- postponement (a supervisor may drop anyone's). postpone: keep it waiting with a reason.
-- assign (manage): claim it for a technician of the department.
create function public.ac_care_work_set(p_hotel_id uuid,p_unit_id uuid,p_service_type text,p_action text,p_note text default '',p_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.ac_care_units; v_work public.ac_care_work; has_work boolean; manager boolean; taken boolean;
begin
 select * into unit from public.ac_care_units where id=p_unit_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('ac-care',unit.hotel_id,unit.department_id,'write') then
  return workstel_private.ac_care_denied(p_hotel_id,unit.department_id,p_unit_id,'ac-care.write');
 end if;
 manager:=workstel_private.module_allowed('ac-care',unit.hotel_id,unit.department_id,'manage');
 if p_action='assign' and not manager then return workstel_private.ac_care_denied(p_hotel_id,unit.department_id,p_unit_id,'ac-care.write');end if;
 if p_action is null or p_action not in ('claim','release','postpone','assign') or p_service_type is null
  or workstel_private.ac_care_rank(p_service_type)=0 or length(coalesce(p_note,''))>200
  or (p_action='postpone' and length(trim(coalesce(p_note,'')))=0) or (p_action='assign' and p_user_id is null) then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 if unit.archived then return jsonb_build_object('error','UNIT_ARCHIVED');end if;
 if workstel_private.ac_care_interval(unit,p_service_type)=0 then return jsonb_build_object('error','NOT_SCHEDULED');end if;
 if p_action='assign' and not workstel_private.ac_care_is_technician(p_user_id,unit.hotel_id,unit.department_id) then
  return jsonb_build_object('error','ASSIGNEE_INVALID');
 end if;
 select * into v_work from public.ac_care_work where unit_id=unit.id and service_type=p_service_type;
 has_work:=found;
 taken:=has_work and v_work.state='claimed' and v_work.expires_at>clock_timestamp() and v_work.user_id<>auth.uid();
 if taken and not manager then return jsonb_build_object('error','CLAIMED_BY_OTHER');end if;
 if p_action='release' then
  if has_work and v_work.user_id<>auth.uid() and v_work.state='postponed' and not manager then return jsonb_build_object('error','CLAIMED_BY_OTHER');end if;
  delete from public.ac_care_work where unit_id=unit.id and service_type=p_service_type;
 else
  insert into public.ac_care_work(unit_id,service_type,hotel_id,department_id,state,user_id,note,at,expires_at,assigned_by)
  values(unit.id,p_service_type,unit.hotel_id,unit.department_id,case when p_action='postpone' then 'postponed' else 'claimed' end,
   case when p_action='assign' then p_user_id else auth.uid() end,trim(coalesce(p_note,'')),clock_timestamp(),
   case when p_action='postpone' then null else clock_timestamp()+interval '8 hours' end,case when p_action='assign' then auth.uid() else null end)
  on conflict (unit_id,service_type) do update set state=excluded.state,user_id=excluded.user_id,note=excluded.note,at=excluded.at,
   expires_at=excluded.expires_at,assigned_by=excluded.assigned_by;
 end if;
 perform workstel_private.ac_care_audit(p_hotel_id,unit.department_id,unit.id,'ac-care.work.'||p_action);
 return jsonb_build_object('data',jsonb_build_object('unit',workstel_private.ac_care_unit_json(unit)));
end$$;

-- Records a service. Required readings: temperatures for routine and larger kinds; pressure and
-- current for major. The server decides the result: attention when an item has an issue, the
-- temperature drop is outside 8-14 degrees, suction pressure is outside the refrigerant's range
-- (R32/R410A 100-150 psi, R22 55-80 psi), current exceeds the rated current by more than 10%, or
-- refrigerant was added again within 90 days. Attention requires notes.
create function public.ac_care_service_record(p_hotel_id uuid,p_unit_id uuid,p_input jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.ac_care_units; saved public.ac_care_services; kind text; required text[]; key text;
 ret numeric; sup numeric; psi integer; amp numeric; refill boolean; reasons text[]:=array[]::text[]; outcome text;
 v_work public.ac_care_work; has_work boolean;
begin
 select * into unit from public.ac_care_units where id=p_unit_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('ac-care',unit.hotel_id,unit.department_id,'write') then
  return workstel_private.ac_care_denied(p_hotel_id,unit.department_id,p_unit_id,'ac-care.write');
 end if;
 if p_idempotency_key is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into saved from public.ac_care_services where done_by=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if saved.unit_id<>unit.id then return jsonb_build_object('error','INVALID_INPUT');end if;
  return jsonb_build_object('data',jsonb_build_object('id',saved.id,'result',saved.result,'reasons',saved.reasons));
 end if;
 if unit.archived then return jsonb_build_object('error','UNIT_ARCHIVED');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('serviceType','items','returnTemp','supplyTemp','pressurePsi','currentAmp','refrigerantAdded','notes'))
  or jsonb_typeof(p_input->'serviceType') is distinct from 'string' or jsonb_typeof(p_input->'items') is distinct from 'object'
  or jsonb_typeof(p_input->'notes') is distinct from 'string' or jsonb_typeof(p_input->'refrigerantAdded') is distinct from 'boolean'
  or exists(select 1 from unnest(array['returnTemp','supplyTemp','pressurePsi','currentAmp']) f where coalesce(jsonb_typeof(p_input->f),'null') not in ('null','number')) then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 kind:=p_input->>'serviceType';
 if workstel_private.ac_care_rank(kind)=0 or length(p_input->>'notes')>1000 then return jsonb_build_object('error','INVALID_INPUT');end if;
 required:=workstel_private.ac_care_items(kind);
 if exists(select 1 from jsonb_each(p_input->'items') e where not (e.key=any(required)) or e.value not in ('"ok"'::jsonb,'"issue"'::jsonb))
  or exists(select 1 from unnest(required) r where not (p_input->'items' ? r)) then return jsonb_build_object('error','INVALID_INPUT');end if;
 ret:=(p_input->>'returnTemp')::numeric; sup:=(p_input->>'supplyTemp')::numeric;
 amp:=(p_input->>'currentAmp')::numeric; refill:=(p_input->>'refrigerantAdded')::boolean;
 if (p_input->>'pressurePsi') is not null then
  if (p_input->>'pressurePsi')::numeric<>trunc((p_input->>'pressurePsi')::numeric) then return jsonb_build_object('error','INVALID_INPUT');end if;
  psi:=(p_input->>'pressurePsi')::integer;
 end if;
 if (ret is not null and ret not between 0 and 50) or (sup is not null and sup not between 0 and 50) or (psi is not null and psi not between 0 and 700)
  or (amp is not null and amp not between 0 and 999.9) or ((ret is null)<>(sup is null)) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if (workstel_private.ac_care_rank(kind)>=2 and ret is null) or (kind='major' and (psi is null or amp is null)) then
  return jsonb_build_object('error','READINGS_REQUIRED');
 end if;
 select * into v_work from public.ac_care_work where unit_id=unit.id and service_type=kind;
 if found and v_work.state='claimed' and v_work.expires_at>clock_timestamp() and v_work.user_id<>auth.uid()
  and not workstel_private.module_allowed('ac-care',unit.hotel_id,unit.department_id,'manage') then
  return jsonb_build_object('error','CLAIMED_BY_OTHER');
 end if;
 if exists(select 1 from jsonb_each_text(p_input->'items') e where e.value='issue') then reasons:=array_append(reasons,'item-issue');end if;
 if ret is not null and (ret-sup<8 or ret-sup>14) then reasons:=array_append(reasons,'temperature-drop');end if;
 if psi is not null and ((unit.refrigerant in ('r32','r410a') and psi not between 100 and 150) or (unit.refrigerant='r22' and psi not between 55 and 80)) then
  reasons:=array_append(reasons,'pressure');
 end if;
 if amp is not null and unit.rated_current is not null and amp>unit.rated_current*1.1 then reasons:=array_append(reasons,'current');end if;
 if refill and exists(select 1 from public.ac_care_services sv where sv.unit_id=unit.id and sv.refrigerant_added and sv.done_at>clock_timestamp()-interval '90 days') then
  reasons:=array_append(reasons,'repeat-refill');
 end if;
 outcome:=case when cardinality(reasons)>0 then 'attention' else 'normal' end;
 if outcome='attention' and length(trim(p_input->>'notes'))=0 then return jsonb_build_object('error','NOTES_REQUIRED');end if;
 insert into public.ac_care_services(hotel_id,department_id,unit_id,service_type,done_by,items,return_temp,supply_temp,pressure_psi,current_amp,
  refrigerant_added,result,reasons,notes,idempotency_key)
 values(unit.hotel_id,unit.department_id,unit.id,kind,auth.uid(),p_input->'items',ret,sup,psi,amp,refill,outcome,to_jsonb(reasons),trim(p_input->>'notes'),p_idempotency_key)
 returning * into saved;
 delete from public.ac_care_work w where w.unit_id=unit.id and workstel_private.ac_care_rank(w.service_type)<=workstel_private.ac_care_rank(kind);
 update public.ac_care_units set condition=outcome where id=unit.id;
 perform workstel_private.ac_care_audit(p_hotel_id,unit.department_id,saved.id,'ac-care.service.record');
 return jsonb_build_object('data',jsonb_build_object('id',saved.id,'result',saved.result,'reasons',saved.reasons));
end$$;

-- A guest or staff complaint about a unit. A normal unit then needs attention.
create function public.ac_care_complaint_record(p_hotel_id uuid,p_unit_id uuid,p_kind text,p_note text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.ac_care_units; saved public.ac_care_complaints;
begin
 select * into unit from public.ac_care_units where id=p_unit_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('ac-care',unit.hotel_id,unit.department_id,'write') then
  return workstel_private.ac_care_denied(p_hotel_id,unit.department_id,p_unit_id,'ac-care.write');
 end if;
 if p_idempotency_key is null or p_kind is null or p_kind not in ('not-cold','leak','noise','smell','not-on','other')
  or length(coalesce(p_note,''))>500 or (p_kind='other' and length(trim(coalesce(p_note,'')))=0) then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 select * into saved from public.ac_care_complaints where reported_by=auth.uid() and idempotency_key=p_idempotency_key;
 if found then return jsonb_build_object('data',jsonb_build_object('id',saved.id));end if;
 if unit.archived then return jsonb_build_object('error','UNIT_ARCHIVED');end if;
 insert into public.ac_care_complaints(hotel_id,department_id,unit_id,kind,note,reported_by,idempotency_key)
 values(unit.hotel_id,unit.department_id,unit.id,p_kind,trim(coalesce(p_note,'')),auth.uid(),p_idempotency_key) returning * into saved;
 update public.ac_care_units set condition='attention' where id=unit.id and condition='normal';
 perform workstel_private.ac_care_audit(p_hotel_id,unit.department_id,saved.id,'ac-care.complaint.record');
 return jsonb_build_object('data',jsonb_build_object('id',saved.id));
end$$;

-- Services and complaints of one unit, newest first, keyset by (time, id).
create function public.ac_care_unit_history(p_hotel_id uuid,p_unit_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare unit public.ac_care_units; result jsonb;
begin
 select * into unit from public.ac_care_units where id=p_unit_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('ac-care',unit.hotel_id,unit.department_id,'read') then
  return workstel_private.ac_care_denied(p_hotel_id,unit.department_id,p_unit_id,'ac-care.history.read');
 end if;
 if p_limit is null or p_limit not between 1 and 50 or ((p_before_at is null)<>(p_before_id is null)) then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(x.row_data order by x.at desc,x.id desc),'[]'::jsonb) into result from (
  select * from (
   select sv.done_at as at,sv.id,jsonb_build_object('kind','service','id',sv.id,'at',sv.done_at,'by_email',workstel_private.ac_care_email(sv.done_by),
    'service_type',sv.service_type,'items',sv.items,'return_temp',sv.return_temp,'supply_temp',sv.supply_temp,'pressure_psi',sv.pressure_psi,
    'current_amp',sv.current_amp,'refrigerant_added',sv.refrigerant_added,'result',sv.result,'reasons',sv.reasons,'notes',sv.notes) as row_data
   from public.ac_care_services sv where sv.unit_id=unit.id
   union all
   select c.reported_at,c.id,jsonb_build_object('kind','complaint','id',c.id,'at',c.reported_at,'by_email',workstel_private.ac_care_email(c.reported_by),
    'complaint',c.kind,'notes',c.note)
   from public.ac_care_complaints c where c.unit_id=unit.id
  ) all_rows
  where p_before_at is null or (all_rows.at,all_rows.id)<(p_before_at,p_before_id)
  order by all_rows.at desc,all_rows.id desc limit p_limit
 ) x;
 perform workstel_private.ac_care_audit(p_hotel_id,unit.department_id,unit.id,'ac-care.history.read');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit
  then jsonb_build_object('at',result->-1->>'at','id',result->-1->>'id') else null end));
end$$;

-- Areas of one department with their technicians, and the technicians who can be added.
create function public.ac_care_areas_list(p_hotel_id uuid,p_department_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare areas jsonb; people jsonb;
begin
 if not workstel_private.module_allowed('ac-care',p_hotel_id,p_department_id,'read') then
  return workstel_private.ac_care_denied(p_hotel_id,p_department_id,null,'ac-care.areas.list');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('area',a.area,'units',a.units,'members',
   (select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',workstel_private.ac_care_email(m.user_id),'backup',m.backup)
     order by m.backup,workstel_private.ac_care_email(m.user_id)),'[]'::jsonb)
    from public.ac_care_area_members m where m.hotel_id=p_hotel_id and m.department_id=p_department_id and upper(m.area)=upper(a.area)))
  order by upper(a.area)),'[]'::jsonb) into areas
 from (select min(n.area) as area,sum(n.units)::integer as units from (
   select u.area,1 as units from public.ac_care_units u where u.hotel_id=p_hotel_id and u.department_id=p_department_id and not u.archived and u.area<>''
   union all select m.area,0 from public.ac_care_area_members m where m.hotel_id=p_hotel_id and m.department_id=p_department_id) n
  group by upper(n.area)) a;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',workstel_private.ac_care_email(m.user_id)) order by workstel_private.ac_care_email(m.user_id)),'[]'::jsonb)
 into people from workstel_private.module_access m
 where m.hotel_id=p_hotel_id and m.department_id=p_department_id and m.module_id='ac-care'
 and workstel_private.ac_care_is_technician(m.user_id,p_hotel_id,p_department_id);
 perform workstel_private.ac_care_audit(p_hotel_id,p_department_id,null,'ac-care.areas.list');
 return jsonb_build_object('data',jsonb_build_object('areas',areas,'technicians',people));
end$$;

-- Supervisors add a technician to an area (as main or backup) or remove them.
create function public.ac_care_area_member_set(p_hotel_id uuid,p_department_id uuid,p_area text,p_user_id uuid,p_action text,p_backup boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_area text:=trim(coalesce(p_area,''));
begin
 if not workstel_private.module_allowed('ac-care',p_hotel_id,p_department_id,'manage') then
  return workstel_private.ac_care_denied(p_hotel_id,p_department_id,p_user_id,'ac-care.write');
 end if;
 if p_action is null or p_action not in ('add','remove') or length(v_area) not between 1 and 40 or p_user_id is null or p_backup is null then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 if p_action='add' then
  if not workstel_private.ac_care_is_technician(p_user_id,p_hotel_id,p_department_id) then return jsonb_build_object('error','ASSIGNEE_INVALID');end if;
  -- Keep the spelling the area already has, so "Floor 5" and "floor 5" stay one area.
  select coalesce((select u.area from public.ac_care_units u where u.hotel_id=p_hotel_id and u.department_id=p_department_id and upper(u.area)=upper(v_area) limit 1),
   (select m.area from public.ac_care_area_members m where m.hotel_id=p_hotel_id and m.department_id=p_department_id and upper(m.area)=upper(v_area) limit 1),v_area) into v_area;
  delete from public.ac_care_area_members m where m.hotel_id=p_hotel_id and m.department_id=p_department_id and upper(m.area)=upper(v_area) and m.user_id=p_user_id;
  insert into public.ac_care_area_members(hotel_id,department_id,area,user_id,backup,created_by) values(p_hotel_id,p_department_id,v_area,p_user_id,p_backup,auth.uid());
 else
  delete from public.ac_care_area_members m where m.hotel_id=p_hotel_id and m.department_id=p_department_id and upper(m.area)=upper(v_area) and m.user_id=p_user_id;
 end if;
 perform workstel_private.ac_care_audit(p_hotel_id,p_department_id,p_user_id,'ac-care.area.'||p_action);
 return jsonb_build_object('data',jsonb_build_object('area',v_area));
end$$;

revoke all on function public.ac_care_units_list(uuid,uuid,boolean) from public,anon;
revoke all on function public.ac_care_unit_save(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.ac_care_units_import(uuid,uuid,jsonb) from public,anon;
revoke all on function public.ac_care_work_set(uuid,uuid,text,text,text,uuid) from public,anon;
revoke all on function public.ac_care_service_record(uuid,uuid,jsonb,uuid) from public,anon;
revoke all on function public.ac_care_complaint_record(uuid,uuid,text,text,uuid) from public,anon;
revoke all on function public.ac_care_unit_history(uuid,uuid,timestamptz,uuid,integer) from public,anon;
revoke all on function public.ac_care_areas_list(uuid,uuid) from public,anon;
revoke all on function public.ac_care_area_member_set(uuid,uuid,text,uuid,text,boolean) from public,anon;
grant execute on function public.ac_care_units_list(uuid,uuid,boolean) to authenticated;
grant execute on function public.ac_care_unit_save(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.ac_care_units_import(uuid,uuid,jsonb) to authenticated;
grant execute on function public.ac_care_work_set(uuid,uuid,text,text,text,uuid) to authenticated;
grant execute on function public.ac_care_service_record(uuid,uuid,jsonb,uuid) to authenticated;
grant execute on function public.ac_care_complaint_record(uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.ac_care_unit_history(uuid,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.ac_care_areas_list(uuid,uuid) to authenticated;
grant execute on function public.ac_care_area_member_set(uuid,uuid,text,uuid,text,boolean) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('ac-care',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611250001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
