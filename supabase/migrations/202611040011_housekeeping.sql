begin;
-- Housekeeping: a Housekeeping department, a room master with live room status, timed
-- cleaning tasks (server clock) and supervisor inspections, scoped per hotel department.
alter table public.workstel_departments drop constraint workstel_departments_code_check;
alter table public.workstel_departments add constraint workstel_departments_code_check
 check(code in ('front-office','sales','engineering','it','accounting','human-resource','admin-general','housekeeping'));
insert into public.workstel_departments(hotel_id,code,name)
select h.id,'housekeeping','Housekeeping' from public.workstel_hotels h
on conflict (hotel_id,code) do nothing;

alter table workstel_private.installed_modules drop constraint installed_modules_module_id_check;
alter table workstel_private.installed_modules add constraint installed_modules_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','housekeeping'));
alter table workstel_private.module_access drop constraint module_access_module_id_check;
alter table workstel_private.module_access add constraint module_access_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','housekeeping'));

create table public.housekeeping_rooms(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 room_number text not null check(room_number ~ '^[A-Za-z0-9-]{1,10}$'),
 floor text not null default '' check(floor ~ '^[A-Za-z0-9 -]{0,10}$'),
 room_type text not null default '' check(length(room_type)<=50),
 status text not null default 'vacant-dirty' check(status in ('vacant-dirty','vacant-clean','vacant-ready','occupied','out-of-order')),
 status_note text not null default '' check(length(status_note)<=200),
 status_changed_at timestamptz not null default now(),
 archived boolean not null default false,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 unique(hotel_id,department_id,id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create unique index housekeeping_rooms_number_idx on public.housekeeping_rooms(hotel_id,department_id,upper(room_number));

-- Times come from the database clock, so a phone cannot shorten or stretch a task.
create table public.housekeeping_tasks(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,room_id uuid not null,
 task_type text not null check(task_type in ('departure','make-up','turndown','pre-arrival','deep-clean')),
 status text not null default 'active' check(status in ('active','paused','done','dnd','refused','cancelled')),
 attendant_id uuid not null references auth.users(id),
 started_at timestamptz not null default clock_timestamp(),
 paused_at timestamptz,paused_seconds integer not null default 0 check(paused_seconds>=0),
 finished_at timestamptz,duration_seconds integer check(duration_seconds>=0),
 notes text not null default '' check(length(notes)<=500),
 check((status='paused')=(paused_at is not null)),
 check((status in ('active','paused'))=(finished_at is null)),
 foreign key(hotel_id,department_id,room_id) references public.housekeeping_rooms(hotel_id,department_id,id)
);
create unique index housekeeping_tasks_open_room_idx on public.housekeeping_tasks(room_id) where status in ('active','paused');
create unique index housekeeping_tasks_open_attendant_idx on public.housekeeping_tasks(attendant_id) where status in ('active','paused');
create index housekeeping_tasks_day_idx on public.housekeeping_tasks(hotel_id,department_id,started_at desc,id desc);
create index housekeeping_tasks_room_idx on public.housekeeping_tasks(room_id,started_at desc);

create table public.housekeeping_inspections(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,room_id uuid not null,
 task_id uuid references public.housekeeping_tasks(id),
 result text not null check(result in ('pass','redo')),
 reason text not null default '' check(length(reason)<=300),
 inspected_at timestamptz not null default clock_timestamp(),inspector_id uuid not null references auth.users(id),
 check(result='pass' or length(trim(reason))>0),
 foreign key(hotel_id,department_id,room_id) references public.housekeeping_rooms(hotel_id,department_id,id)
);
create index housekeeping_inspections_day_idx on public.housekeeping_inspections(hotel_id,department_id,inspected_at desc);
alter table public.housekeeping_rooms enable row level security;
alter table public.housekeeping_tasks enable row level security;
alter table public.housekeeping_inspections enable row level security;
revoke all on public.housekeeping_rooms,public.housekeeping_tasks,public.housekeeping_inspections from public,anon,authenticated;

create function workstel_private.reject_housekeeping_inspection_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'Housekeeping inspections are append-only';end$$;
create trigger housekeeping_inspections_append_only before update or delete on public.housekeeping_inspections
 for each row execute function workstel_private.reject_housekeeping_inspection_change();
revoke all on function workstel_private.reject_housekeeping_inspection_change() from public,anon,authenticated;

create function workstel_private.housekeeping_denied(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'denied');
 return jsonb_build_object('error','ACCESS_DENIED');
end$$;
revoke all on function workstel_private.housekeeping_denied(uuid,uuid,uuid,text) from public,anon,authenticated;

create function workstel_private.housekeeping_audit(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns void language sql security definer set search_path='' as $$
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'success') $$;
revoke all on function workstel_private.housekeeping_audit(uuid,uuid,uuid,text) from public,anon,authenticated;

create function workstel_private.housekeeping_task_json(p_task public.housekeeping_tasks)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_task.id,'room_id',p_task.room_id,'task_type',p_task.task_type,'status',p_task.status,
  'attendant_email',coalesce((select u.email from auth.users u where u.id=p_task.attendant_id),''),'mine',p_task.attendant_id=auth.uid(),
  'started_at',p_task.started_at,'paused_at',p_task.paused_at,'paused_seconds',p_task.paused_seconds,
  'finished_at',p_task.finished_at,'duration_seconds',p_task.duration_seconds,'notes',p_task.notes) $$;
revoke all on function workstel_private.housekeeping_task_json(public.housekeeping_tasks) from public,anon,authenticated;

-- The whole board for the departments the caller can read, with each room's open task.
create function public.housekeeping_rooms_list(p_hotel_id uuid,p_department_id uuid default null,p_include_archived boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('housekeeping',p_hotel_id,d.id,'read')) then
  return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,null,'housekeeping.rooms.list');
 end if;
 if p_include_archived is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(x.row_data order by x.sort_floor,x.sort_number),'[]'::jsonb) into result from (
  select jsonb_build_object('id',r.id,'hotel_id',r.hotel_id,'department_id',r.department_id,'department_name',d.name,
   'room_number',r.room_number,'floor',r.floor,'room_type',r.room_type,'status',r.status,'status_note',r.status_note,
   'status_changed_at',r.status_changed_at,'archived',r.archived,'version',r.version,
   'open_task',(select workstel_private.housekeeping_task_json(t) from public.housekeeping_tasks t where t.room_id=r.id and t.status in ('active','paused')),
   'last_cleaned_at',(select max(t.finished_at) from public.housekeeping_tasks t where t.room_id=r.id and t.status='done')) as row_data,
   lpad(upper(r.floor),10,'0') as sort_floor,lpad(upper(r.room_number),10,'0') as sort_number
  from public.housekeeping_rooms r join public.workstel_departments d on d.hotel_id=r.hotel_id and d.id=r.department_id
  where r.hotel_id=p_hotel_id and workstel_private.module_allowed('housekeeping',r.hotel_id,r.department_id,'read')
  and (p_department_id is null or r.department_id=p_department_id) and (p_include_archived or not r.archived)
  limit 1000
 ) x;
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,null,'housekeeping.rooms.list');
 return jsonb_build_object('data',result);
end$$;

-- Supervisors (manage) maintain the room master: add, edit, archive, restore and import.
create function public.housekeeping_room_save(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_room_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.housekeeping_rooms; existing public.housekeeping_rooms;
begin
 if not workstel_private.module_allowed('housekeeping',p_hotel_id,p_department_id,'manage') then
  return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,p_room_id,'housekeeping.write');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_room_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_room_id is not null then
  select * into existing from public.housekeeping_rooms where id=p_room_id and hotel_id=p_hotel_id and department_id=p_department_id for update;
  if not found then return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,p_room_id,'housekeeping.write');end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
  if p_action='archive' and exists(select 1 from public.housekeeping_tasks t where t.room_id=existing.id and t.status in ('active','paused')) then
   return jsonb_build_object('error','TASK_OPEN');
  end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('roomNumber','floor','roomType'))
   or exists(select 1 from jsonb_each(p_input) e where jsonb_typeof(e.value)<>'string')
   or not (p_input ? 'roomNumber')
   or trim(p_input->>'roomNumber') !~ '^[A-Za-z0-9-]{1,10}$'
   or trim(coalesce(p_input->>'floor','')) !~ '^[A-Za-z0-9 -]{0,10}$'
   or length(trim(coalesce(p_input->>'roomType','')))>50 then return jsonb_build_object('error','INVALID_INPUT');end if;
  if exists(select 1 from public.housekeeping_rooms r where r.hotel_id=p_hotel_id and r.department_id=p_department_id
   and upper(r.room_number)=upper(trim(p_input->>'roomNumber')) and r.id is distinct from p_room_id) then return jsonb_build_object('error','DUPLICATE_ROOM');end if;
  if p_room_id is null then
   insert into public.housekeeping_rooms(hotel_id,department_id,room_number,floor,room_type,created_by,updated_by)
   values(p_hotel_id,p_department_id,upper(trim(p_input->>'roomNumber')),trim(coalesce(p_input->>'floor','')),trim(coalesce(p_input->>'roomType','')),auth.uid(),auth.uid()) returning * into room;
  else
   update public.housekeeping_rooms set room_number=upper(trim(p_input->>'roomNumber')),floor=trim(coalesce(p_input->>'floor','')),room_type=trim(coalesce(p_input->>'roomType','')),
    version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_room_id returning * into room;
  end if;
 else
  update public.housekeeping_rooms set archived=(p_action='archive'),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_room_id returning * into room;
 end if;
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,room.id,'housekeeping.room.'||p_action);
 return jsonb_build_object('data',jsonb_build_object('id',room.id,'version',room.version));
end$$;

-- Adds up to 500 rooms at once (for example pasted from a spreadsheet); existing numbers are skipped.
create function public.housekeeping_rooms_import(p_hotel_id uuid,p_department_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if not workstel_private.module_allowed('housekeeping',p_hotel_id,p_department_id,'manage') then
  return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,null,'housekeeping.write');
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500
  or exists(select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e)<>'object'
   or exists(select 1 from jsonb_object_keys(e) k where k not in ('roomNumber','floor','roomType'))
   or exists(select 1 from jsonb_each(e) f where jsonb_typeof(f.value)<>'string')
   or trim(coalesce(e->>'roomNumber','')) !~ '^[A-Za-z0-9-]{1,10}$'
   or trim(coalesce(e->>'floor','')) !~ '^[A-Za-z0-9 -]{0,10}$'
   or length(trim(coalesce(e->>'roomType','')))>50) then return jsonb_build_object('error','INVALID_INPUT');end if;
 with incoming as (
  select distinct on (upper(trim(e->>'roomNumber'))) upper(trim(e->>'roomNumber')) as room_number,trim(coalesce(e->>'floor','')) as floor,trim(coalesce(e->>'roomType','')) as room_type
  from jsonb_array_elements(p_rows) e
 ), inserted as (
  insert into public.housekeeping_rooms(hotel_id,department_id,room_number,floor,room_type,created_by,updated_by)
  select p_hotel_id,p_department_id,i.room_number,i.floor,i.room_type,auth.uid(),auth.uid() from incoming i
  where not exists(select 1 from public.housekeeping_rooms r where r.hotel_id=p_hotel_id and r.department_id=p_department_id and upper(r.room_number)=i.room_number)
  returning 1
 ) select count(*) into added from inserted;
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,null,'housekeeping.room.import');
 return jsonb_build_object('data',jsonb_build_object('added',added,'skipped',jsonb_array_length(p_rows)-added));
end$$;

-- write marks check-out (vacant dirty), check-in (occupied) and out of order; manage may set
-- any status as a supervisor override. Clean and ready come from tasks and inspections.
create function public.housekeeping_room_set_status(p_hotel_id uuid,p_room_id uuid,p_status text,p_expected_version integer,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.housekeeping_rooms;
begin
 select * into room from public.housekeeping_rooms where id=p_room_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('housekeeping',room.hotel_id,room.department_id,'write') then
  return workstel_private.housekeeping_denied(p_hotel_id,room.department_id,p_room_id,'housekeeping.write');
 end if;
 if p_status is null or p_status not in ('vacant-dirty','vacant-clean','vacant-ready','occupied','out-of-order') or p_note is null or length(trim(p_note))>200 or room.archived then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 if p_status in ('vacant-clean','vacant-ready') and not workstel_private.module_allowed('housekeeping',room.hotel_id,room.department_id,'manage') then
  return workstel_private.housekeeping_denied(p_hotel_id,room.department_id,p_room_id,'housekeeping.write');
 end if;
 if p_status='out-of-order' and trim(p_note)='' then return jsonb_build_object('error','NOTE_REQUIRED');end if;
 if p_expected_version is null or room.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 if exists(select 1 from public.housekeeping_tasks t where t.room_id=room.id and t.status in ('active','paused')) then return jsonb_build_object('error','TASK_OPEN');end if;
 update public.housekeeping_rooms set status=p_status,status_note=trim(p_note),status_changed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
 where id=room.id returning * into room;
 perform workstel_private.housekeeping_audit(p_hotel_id,room.department_id,room.id,'housekeeping.room.status');
 return jsonb_build_object('data',jsonb_build_object('id',room.id,'version',room.version,'status',room.status));
end$$;

-- Starts a timed task for the caller. Departure needs a vacant dirty room, make-up room and
-- turndown an occupied room, pre-arrival a clean or ready room, deep clean any vacant room.
-- With an outcome of dnd or refused it records a declined service without a timer.
create function public.housekeeping_task_start(p_hotel_id uuid,p_room_id uuid,p_task_type text,p_outcome text default null,p_notes text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.housekeeping_rooms; task public.housekeeping_tasks; allowed boolean;
begin
 select * into room from public.housekeeping_rooms where id=p_room_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('housekeeping',room.hotel_id,room.department_id,'write') then
  return workstel_private.housekeeping_denied(p_hotel_id,room.department_id,p_room_id,'housekeeping.write');
 end if;
 if p_task_type is null or p_task_type not in ('departure','make-up','turndown','pre-arrival','deep-clean') or room.archived
  or (p_outcome is not null and (p_outcome not in ('dnd','refused') or p_task_type not in ('make-up','turndown')))
  or p_notes is null or length(trim(p_notes))>500 then return jsonb_build_object('error','INVALID_INPUT');end if;
 -- A CASE cannot sit inside an IF condition in PL/pgSQL, so the rule is computed first.
 allowed:=case p_task_type
   when 'departure' then room.status='vacant-dirty'
   when 'make-up' then room.status='occupied'
   when 'turndown' then room.status='occupied'
   when 'pre-arrival' then room.status in ('vacant-clean','vacant-ready')
   else room.status in ('vacant-dirty','vacant-clean','vacant-ready') end;
 if not allowed then return jsonb_build_object('error','WRONG_ROOM_STATUS');end if;
 if p_outcome is not null then
  insert into public.housekeeping_tasks(hotel_id,department_id,room_id,task_type,status,attendant_id,finished_at,duration_seconds,notes)
  values(room.hotel_id,room.department_id,room.id,p_task_type,p_outcome,auth.uid(),clock_timestamp(),0,trim(p_notes)) returning * into task;
  perform workstel_private.housekeeping_audit(p_hotel_id,room.department_id,task.id,'housekeeping.task.'||p_outcome);
  return jsonb_build_object('data',workstel_private.housekeeping_task_json(task));
 end if;
 if exists(select 1 from public.housekeeping_tasks t where t.room_id=room.id and t.status in ('active','paused')) then return jsonb_build_object('error','ROOM_BUSY');end if;
 if exists(select 1 from public.housekeeping_tasks t where t.attendant_id=auth.uid() and t.status in ('active','paused')) then return jsonb_build_object('error','ATTENDANT_BUSY');end if;
 begin
  insert into public.housekeeping_tasks(hotel_id,department_id,room_id,task_type,attendant_id,notes)
  values(room.hotel_id,room.department_id,room.id,p_task_type,auth.uid(),trim(p_notes)) returning * into task;
 exception when unique_violation then return jsonb_build_object('error','ROOM_BUSY');
 end;
 perform workstel_private.housekeeping_audit(p_hotel_id,room.department_id,task.id,'housekeeping.task.start');
 return jsonb_build_object('data',workstel_private.housekeeping_task_json(task));
end$$;

-- pause, resume, finish (done, dnd or refused) and cancel. The attendant acts on their own
-- task; a supervisor (manage) may act on anyone's. A finished cleaning makes a vacant room clean.
create function public.housekeeping_task_update(p_hotel_id uuid,p_task_id uuid,p_action text,p_outcome text default 'done',p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task public.housekeeping_tasks; room public.housekeeping_rooms; now_at timestamptz:=clock_timestamp(); paused integer;
begin
 select * into task from public.housekeeping_tasks where id=p_task_id and hotel_id=p_hotel_id for update;
 if not found or not (
  (task.attendant_id=auth.uid() and workstel_private.module_allowed('housekeeping',task.hotel_id,task.department_id,'write'))
  or workstel_private.module_allowed('housekeeping',task.hotel_id,task.department_id,'manage')) then
  return workstel_private.housekeeping_denied(p_hotel_id,task.department_id,p_task_id,'housekeeping.write');
 end if;
 if p_action is null or p_action not in ('pause','resume','finish','cancel')
  or (p_action='finish' and (p_outcome is null or p_outcome not in ('done','dnd','refused')))
  or (p_action='finish' and p_outcome<>'done' and task.task_type not in ('make-up','turndown'))
  or (p_notes is not null and length(trim(p_notes))>500) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if task.status not in ('active','paused') or (p_action='pause' and task.status<>'active') or (p_action='resume' and task.status<>'paused') then
  return jsonb_build_object('error','TASK_CLOSED');
 end if;
 select * into room from public.housekeeping_rooms where id=task.room_id for update;
 paused:=task.paused_seconds+case when task.status='paused' then floor(extract(epoch from now_at-task.paused_at))::integer else 0 end;
 if p_action='pause' then
  update public.housekeeping_tasks set status='paused',paused_at=now_at where id=task.id returning * into task;
 elsif p_action='resume' then
  update public.housekeeping_tasks set status='active',paused_at=null,paused_seconds=paused where id=task.id returning * into task;
 else
  update public.housekeeping_tasks set status=case when p_action='cancel' then 'cancelled' else p_outcome end,paused_at=null,paused_seconds=paused,finished_at=now_at,
   duration_seconds=case when p_action='cancel' then null else greatest(0,floor(extract(epoch from now_at-started_at))::integer-paused) end,
   notes=coalesce(trim(p_notes),notes)
  where id=task.id returning * into task;
  if task.status='done' and task.task_type in ('departure','deep-clean') and room.status like 'vacant-%' then
   update public.housekeeping_rooms set status='vacant-clean',status_note='',status_changed_at=now_at,version=version+1,updated_at=now_at,updated_by=auth.uid() where id=room.id;
  end if;
 end if;
 perform workstel_private.housekeeping_audit(p_hotel_id,task.department_id,task.id,'housekeeping.task.'||case when p_action='finish' then p_outcome else p_action end);
 return jsonb_build_object('data',workstel_private.housekeeping_task_json(task));
end$$;

-- Supervisors inspect clean rooms: pass makes the room ready, redo sends it back as dirty.
create function public.housekeeping_inspect(p_hotel_id uuid,p_room_id uuid,p_result text,p_expected_version integer,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.housekeeping_rooms; inspection public.housekeeping_inspections;
begin
 select * into room from public.housekeeping_rooms where id=p_room_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('housekeeping',room.hotel_id,room.department_id,'manage') then
  return workstel_private.housekeeping_denied(p_hotel_id,room.department_id,p_room_id,'housekeeping.write');
 end if;
 if p_result is null or p_result not in ('pass','redo') or p_reason is null or length(trim(p_reason))>300 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_result='redo' and trim(p_reason)='' then return jsonb_build_object('error','NOTE_REQUIRED');end if;
 if p_expected_version is null or room.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 if room.status<>'vacant-clean' or exists(select 1 from public.housekeeping_tasks t where t.room_id=room.id and t.status in ('active','paused')) then
  return jsonb_build_object('error','WRONG_ROOM_STATUS');
 end if;
 insert into public.housekeeping_inspections(hotel_id,department_id,room_id,task_id,result,reason,inspector_id)
 values(room.hotel_id,room.department_id,room.id,
  (select t.id from public.housekeeping_tasks t where t.room_id=room.id and t.status='done' order by t.finished_at desc limit 1),
  p_result,trim(p_reason),auth.uid()) returning * into inspection;
 update public.housekeeping_rooms set status=case when p_result='pass' then 'vacant-ready' else 'vacant-dirty' end,
  status_note=case when p_result='pass' then '' else trim(p_reason) end,status_changed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
 where id=room.id returning * into room;
 perform workstel_private.housekeeping_audit(p_hotel_id,room.department_id,inspection.id,'housekeeping.inspection.'||p_result);
 return jsonb_build_object('data',jsonb_build_object('id',room.id,'version',room.version,'status',room.status));
end$$;

-- Tasks started on one hotel calendar day (Asia/Jakarta), newest first, optionally one room.
create function public.housekeeping_tasks_list(p_hotel_id uuid,p_department_id uuid default null,p_day date default null,p_room_id uuid default null,p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; day_start timestamptz; cursor_row public.housekeeping_tasks;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('housekeeping',p_hotel_id,d.id,'read')) then
  return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,p_room_id,'housekeeping.tasks.list');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 or (p_day is null and p_room_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 day_start:=p_day::timestamp at time zone 'Asia/Jakarta';
 if p_after is not null then select * into cursor_row from public.housekeeping_tasks where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(row_data order by (row_data->>'started_at')::timestamptz desc,row_data->>'id' desc),'[]'::jsonb) into result from (
  select workstel_private.housekeeping_task_json(t)||jsonb_build_object('room_number',r.room_number,'department_id',t.department_id) as row_data
  from public.housekeeping_tasks t join public.housekeeping_rooms r on r.id=t.room_id
  where t.hotel_id=p_hotel_id and workstel_private.module_allowed('housekeeping',t.hotel_id,t.department_id,'read')
  and (p_department_id is null or t.department_id=p_department_id)
  and (p_room_id is null or t.room_id=p_room_id)
  and (p_day is null or (t.started_at>=day_start and t.started_at<day_start+interval '1 day'))
  and (cursor_row.id is null or (t.started_at,t.id)<(cursor_row.started_at,cursor_row.id))
  order by t.started_at desc,t.id desc limit p_limit
 ) rows_data;
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,p_room_id,'housekeeping.tasks.list');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

-- Current room status counts plus one day's task durations, outcomes, inspections and attendants.
create function public.housekeeping_summary(p_hotel_id uuid,p_department_id uuid default null,p_day date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_day date:=coalesce(p_day,(now() at time zone 'Asia/Jakarta')::date); day_start timestamptz; statuses jsonb; types jsonb; people jsonb; inspections jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('housekeeping',p_hotel_id,d.id,'read')) then
  return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,null,'housekeeping.summary');
 end if;
 day_start:=target_day::timestamp at time zone 'Asia/Jakarta';
 select jsonb_build_object(
  'vacant-dirty',count(*) filter(where r.status='vacant-dirty'),'vacant-clean',count(*) filter(where r.status='vacant-clean'),
  'vacant-ready',count(*) filter(where r.status='vacant-ready'),'occupied',count(*) filter(where r.status='occupied'),
  'out-of-order',count(*) filter(where r.status='out-of-order'),
  'in-progress',count(*) filter(where exists(select 1 from public.housekeeping_tasks t where t.room_id=r.id and t.status in ('active','paused'))))
 into statuses from public.housekeeping_rooms r
 where r.hotel_id=p_hotel_id and not r.archived and (p_department_id is null or r.department_id=p_department_id)
 and workstel_private.module_allowed('housekeeping',r.hotel_id,r.department_id,'read');
 select coalesce(jsonb_object_agg(x.task_type,jsonb_build_object('done',x.done,'avg_seconds',x.avg_seconds,'declined',x.declined)),'{}'::jsonb) into types from (
  select t.task_type,count(*) filter(where t.status='done') as done,coalesce(round(avg(t.duration_seconds) filter(where t.status='done'))::integer,0) as avg_seconds,
   count(*) filter(where t.status in ('dnd','refused')) as declined
  from public.housekeeping_tasks t
  where t.hotel_id=p_hotel_id and (p_department_id is null or t.department_id=p_department_id)
  and workstel_private.module_allowed('housekeeping',t.hotel_id,t.department_id,'read')
  and t.started_at>=day_start and t.started_at<day_start+interval '1 day'
  group by t.task_type) x;
 select coalesce(jsonb_agg(jsonb_build_object('email',x.email,'done',x.done,'avg_seconds',x.avg_seconds,'total_seconds',x.total_seconds) order by x.done desc,x.email),'[]'::jsonb) into people from (
  select coalesce(u.email,'') as email,count(*) as done,round(avg(t.duration_seconds))::integer as avg_seconds,sum(t.duration_seconds)::integer as total_seconds
  from public.housekeeping_tasks t left join auth.users u on u.id=t.attendant_id
  where t.hotel_id=p_hotel_id and t.status='done' and (p_department_id is null or t.department_id=p_department_id)
  and workstel_private.module_allowed('housekeeping',t.hotel_id,t.department_id,'read')
  and t.started_at>=day_start and t.started_at<day_start+interval '1 day'
  group by u.email) x;
 select jsonb_build_object('pass',count(*) filter(where i.result='pass'),'redo',count(*) filter(where i.result='redo')) into inspections
 from public.housekeeping_inspections i
 where i.hotel_id=p_hotel_id and (p_department_id is null or i.department_id=p_department_id)
 and workstel_private.module_allowed('housekeeping',i.hotel_id,i.department_id,'read')
 and i.inspected_at>=day_start and i.inspected_at<day_start+interval '1 day';
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,null,'housekeeping.summary');
 return jsonb_build_object('data',jsonb_build_object('statuses',statuses,'task_types',types,'attendants',people,'inspections',inspections),
  'meta',jsonb_build_object('day',target_day,'now',clock_timestamp()));
end$$;

revoke all on function public.housekeeping_rooms_list(uuid,uuid,boolean) from public,anon;
revoke all on function public.housekeeping_room_save(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.housekeeping_rooms_import(uuid,uuid,jsonb) from public,anon;
revoke all on function public.housekeeping_room_set_status(uuid,uuid,text,integer,text) from public,anon;
revoke all on function public.housekeeping_task_start(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.housekeeping_task_update(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.housekeeping_inspect(uuid,uuid,text,integer,text) from public,anon;
revoke all on function public.housekeeping_tasks_list(uuid,uuid,date,uuid,uuid,integer) from public,anon;
revoke all on function public.housekeeping_summary(uuid,uuid,date) from public,anon;
grant execute on function public.housekeeping_rooms_list(uuid,uuid,boolean) to authenticated;
grant execute on function public.housekeeping_room_save(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.housekeeping_rooms_import(uuid,uuid,jsonb) to authenticated;
grant execute on function public.housekeeping_room_set_status(uuid,uuid,text,integer,text) to authenticated;
grant execute on function public.housekeeping_task_start(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.housekeeping_task_update(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.housekeeping_inspect(uuid,uuid,text,integer,text) to authenticated;
grant execute on function public.housekeeping_tasks_list(uuid,uuid,date,uuid,uuid,integer) to authenticated;
grant execute on function public.housekeeping_summary(uuid,uuid,date) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('housekeeping',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611040011') on conflict do nothing;
notify pgrst,'reload schema';
commit;
