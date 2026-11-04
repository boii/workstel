begin;
-- The Housekeeping timer module becomes Room Turnaround: module ID room-turnaround, tables
-- room_turnaround_*, RPCs room_turnaround_* and audit actions room-turnaround.*. Grants and
-- the module switch move to the new ID. The Housekeeping department keeps its name and code.
-- Earlier housekeeping.* audit events stay as recorded.
alter table workstel_private.installed_modules drop constraint installed_modules_module_id_check;
alter table workstel_private.module_access drop constraint module_access_module_id_check;
update workstel_private.installed_modules set module_id='room-turnaround' where module_id='housekeeping';
update workstel_private.module_access set module_id='room-turnaround' where module_id='housekeeping';
alter table workstel_private.installed_modules add constraint installed_modules_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','room-turnaround'));
alter table workstel_private.module_access add constraint module_access_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','room-turnaround'));

drop function public.housekeeping_rooms_list(uuid,uuid,boolean);
drop function public.housekeeping_room_save(uuid,uuid,jsonb,uuid,integer,text);
drop function public.housekeeping_rooms_import(uuid,uuid,jsonb);
drop function public.housekeeping_task_start(uuid,uuid,text);
drop function public.housekeeping_task_update(uuid,uuid,text);
drop function public.housekeeping_tasks_list(uuid,uuid,date,uuid,uuid,integer);
drop function public.housekeeping_summary(uuid,uuid,date);
drop function workstel_private.housekeeping_task_json(public.housekeeping_tasks);
drop function workstel_private.housekeeping_denied(uuid,uuid,uuid,text);
drop function workstel_private.housekeeping_audit(uuid,uuid,uuid,text);

alter table public.housekeeping_rooms rename to room_turnaround_rooms;
alter table public.housekeeping_tasks rename to room_turnaround_tasks;
alter index public.housekeeping_rooms_number_idx rename to room_turnaround_rooms_number_idx;
alter index public.housekeeping_tasks_open_room_idx rename to room_turnaround_tasks_open_room_idx;
alter index public.housekeeping_tasks_open_attendant_idx rename to room_turnaround_tasks_open_attendant_idx;
alter index public.housekeeping_tasks_day_idx rename to room_turnaround_tasks_day_idx;
alter index public.housekeeping_tasks_room_idx rename to room_turnaround_tasks_room_idx;

create function workstel_private.room_turnaround_denied(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'denied');
 return jsonb_build_object('error','ACCESS_DENIED');
end$$;
create function workstel_private.room_turnaround_audit(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns void language sql security definer set search_path='' as $$
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'success') $$;
create function workstel_private.room_turnaround_task_json(p_task public.room_turnaround_tasks)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_task.id,'room_id',p_task.room_id,'task_type',p_task.task_type,'status',p_task.status,
  'attendant_email',coalesce((select u.email from auth.users u where u.id=p_task.attendant_id),''),'mine',p_task.attendant_id=auth.uid(),
  'started_at',p_task.started_at,'paused_at',p_task.paused_at,'paused_seconds',p_task.paused_seconds,
  'finished_at',p_task.finished_at,'duration_seconds',p_task.duration_seconds) $$;
revoke all on function workstel_private.room_turnaround_denied(uuid,uuid,uuid,text),workstel_private.room_turnaround_audit(uuid,uuid,uuid,text),
 workstel_private.room_turnaround_task_json(public.room_turnaround_tasks) from public,anon,authenticated;

-- All rooms the caller can read, each with its running timer and the last cleaning.
create function public.room_turnaround_rooms_list(p_hotel_id uuid,p_department_id uuid default null,p_include_archived boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('room-turnaround',p_hotel_id,d.id,'read')) then
  return workstel_private.room_turnaround_denied(p_hotel_id,p_department_id,null,'room-turnaround.rooms.list');
 end if;
 if p_include_archived is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(x.row_data order by x.sort_floor,x.sort_number),'[]'::jsonb) into result from (
  select jsonb_build_object('id',r.id,'hotel_id',r.hotel_id,'department_id',r.department_id,'department_name',d.name,
   'room_number',r.room_number,'floor',r.floor,'room_type',r.room_type,'archived',r.archived,'version',r.version,
   'open_task',(select workstel_private.room_turnaround_task_json(t) from public.room_turnaround_tasks t where t.room_id=r.id and t.status in ('active','paused')),
   'last_done',(select jsonb_build_object('finished_at',t.finished_at,'duration_seconds',t.duration_seconds,'task_type',t.task_type)
     from public.room_turnaround_tasks t where t.room_id=r.id and t.status='done' order by t.finished_at desc limit 1)) as row_data,
   lpad(upper(r.floor),10,'0') as sort_floor,lpad(upper(r.room_number),10,'0') as sort_number
  from public.room_turnaround_rooms r join public.workstel_departments d on d.hotel_id=r.hotel_id and d.id=r.department_id
  where r.hotel_id=p_hotel_id and workstel_private.module_allowed('room-turnaround',r.hotel_id,r.department_id,'read')
  and (p_department_id is null or r.department_id=p_department_id) and (p_include_archived or not r.archived)
  limit 1000
 ) x;
 perform workstel_private.room_turnaround_audit(p_hotel_id,p_department_id,null,'room-turnaround.rooms.list');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('now',clock_timestamp()));
end$$;

-- Supervisors (manage) maintain the room list: add, edit, archive and restore.
create function public.room_turnaround_room_save(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_room_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.room_turnaround_rooms; existing public.room_turnaround_rooms;
begin
 if not workstel_private.module_allowed('room-turnaround',p_hotel_id,p_department_id,'manage') then
  return workstel_private.room_turnaround_denied(p_hotel_id,p_department_id,p_room_id,'room-turnaround.write');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_room_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_room_id is not null then
  select * into existing from public.room_turnaround_rooms where id=p_room_id and hotel_id=p_hotel_id and department_id=p_department_id for update;
  if not found then return workstel_private.room_turnaround_denied(p_hotel_id,p_department_id,p_room_id,'room-turnaround.write');end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
  if p_action='archive' and exists(select 1 from public.room_turnaround_tasks t where t.room_id=existing.id and t.status in ('active','paused')) then
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
  if exists(select 1 from public.room_turnaround_rooms r where r.hotel_id=p_hotel_id and r.department_id=p_department_id
   and upper(r.room_number)=upper(trim(p_input->>'roomNumber')) and r.id is distinct from p_room_id) then return jsonb_build_object('error','DUPLICATE_ROOM');end if;
  if p_room_id is null then
   insert into public.room_turnaround_rooms(hotel_id,department_id,room_number,floor,room_type,created_by,updated_by)
   values(p_hotel_id,p_department_id,upper(trim(p_input->>'roomNumber')),trim(coalesce(p_input->>'floor','')),trim(coalesce(p_input->>'roomType','')),auth.uid(),auth.uid()) returning * into room;
  else
   update public.room_turnaround_rooms set room_number=upper(trim(p_input->>'roomNumber')),floor=trim(coalesce(p_input->>'floor','')),room_type=trim(coalesce(p_input->>'roomType','')),
    version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_room_id returning * into room;
  end if;
 else
  update public.room_turnaround_rooms set archived=(p_action='archive'),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=p_room_id returning * into room;
 end if;
 perform workstel_private.room_turnaround_audit(p_hotel_id,p_department_id,room.id,'room-turnaround.room.'||p_action);
 return jsonb_build_object('data',jsonb_build_object('id',room.id,'version',room.version));
end$$;

-- Adds up to 500 rooms at once (for example pasted from a spreadsheet); existing numbers are skipped.
create function public.room_turnaround_rooms_import(p_hotel_id uuid,p_department_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 if not workstel_private.module_allowed('room-turnaround',p_hotel_id,p_department_id,'manage') then
  return workstel_private.room_turnaround_denied(p_hotel_id,p_department_id,null,'room-turnaround.write');
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
  insert into public.room_turnaround_rooms(hotel_id,department_id,room_number,floor,room_type,created_by,updated_by)
  select p_hotel_id,p_department_id,i.room_number,i.floor,i.room_type,auth.uid(),auth.uid() from incoming i
  where not exists(select 1 from public.room_turnaround_rooms r where r.hotel_id=p_hotel_id and r.department_id=p_department_id and upper(r.room_number)=i.room_number)
  returning 1
 ) select count(*) into added from inserted;
 perform workstel_private.room_turnaround_audit(p_hotel_id,p_department_id,null,'room-turnaround.room.import');
 return jsonb_build_object('data',jsonb_build_object('added',added,'skipped',jsonb_array_length(p_rows)-added));
end$$;

-- Starts the caller's timer on a room. One running timer per room and per attendant.
create function public.room_turnaround_task_start(p_hotel_id uuid,p_room_id uuid,p_task_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.room_turnaround_rooms; task public.room_turnaround_tasks;
begin
 select * into room from public.room_turnaround_rooms where id=p_room_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('room-turnaround',room.hotel_id,room.department_id,'write') then
  return workstel_private.room_turnaround_denied(p_hotel_id,room.department_id,p_room_id,'room-turnaround.write');
 end if;
 if p_task_type is null or p_task_type not in ('departure','make-up','other') or room.archived then return jsonb_build_object('error','INVALID_INPUT');end if;
 if exists(select 1 from public.room_turnaround_tasks t where t.room_id=room.id and t.status in ('active','paused')) then return jsonb_build_object('error','ROOM_BUSY');end if;
 if exists(select 1 from public.room_turnaround_tasks t where t.attendant_id=auth.uid() and t.status in ('active','paused')) then return jsonb_build_object('error','ATTENDANT_BUSY');end if;
 begin
  insert into public.room_turnaround_tasks(hotel_id,department_id,room_id,task_type,attendant_id)
  values(room.hotel_id,room.department_id,room.id,p_task_type,auth.uid()) returning * into task;
 exception when unique_violation then return jsonb_build_object('error','ROOM_BUSY');
 end;
 perform workstel_private.room_turnaround_audit(p_hotel_id,room.department_id,task.id,'room-turnaround.task.start');
 return jsonb_build_object('data',workstel_private.room_turnaround_task_json(task));
end$$;

-- pause, resume, finish and cancel. The attendant acts on their own timer; a supervisor
-- (manage) may act on anyone's. Durations come from the server clock and exclude pauses.
create function public.room_turnaround_task_update(p_hotel_id uuid,p_task_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task public.room_turnaround_tasks; now_at timestamptz:=clock_timestamp(); paused integer;
begin
 select * into task from public.room_turnaround_tasks where id=p_task_id and hotel_id=p_hotel_id for update;
 if not found or not (
  (task.attendant_id=auth.uid() and workstel_private.module_allowed('room-turnaround',task.hotel_id,task.department_id,'write'))
  or workstel_private.module_allowed('room-turnaround',task.hotel_id,task.department_id,'manage')) then
  return workstel_private.room_turnaround_denied(p_hotel_id,task.department_id,p_task_id,'room-turnaround.write');
 end if;
 if p_action is null or p_action not in ('pause','resume','finish','cancel') then return jsonb_build_object('error','INVALID_INPUT');end if;
 if task.status not in ('active','paused') or (p_action='pause' and task.status<>'active') or (p_action='resume' and task.status<>'paused') then
  return jsonb_build_object('error','TASK_CLOSED');
 end if;
 paused:=task.paused_seconds+case when task.status='paused' then floor(extract(epoch from now_at-task.paused_at))::integer else 0 end;
 if p_action='pause' then
  update public.room_turnaround_tasks set status='paused',paused_at=now_at where id=task.id returning * into task;
 elsif p_action='resume' then
  update public.room_turnaround_tasks set status='active',paused_at=null,paused_seconds=paused where id=task.id returning * into task;
 else
  update public.room_turnaround_tasks set status=case when p_action='cancel' then 'cancelled' else 'done' end,paused_at=null,paused_seconds=paused,finished_at=now_at,
   duration_seconds=case when p_action='cancel' then null else greatest(0,floor(extract(epoch from now_at-started_at))::integer-paused) end
  where id=task.id returning * into task;
 end if;
 perform workstel_private.room_turnaround_audit(p_hotel_id,task.department_id,task.id,'room-turnaround.task.'||case when p_action='finish' then 'done' else p_action end);
 return jsonb_build_object('data',workstel_private.room_turnaround_task_json(task));
end$$;

-- Timers of one hotel calendar day (Asia/Jakarta) or of one room, newest first.
create function public.room_turnaround_tasks_list(p_hotel_id uuid,p_department_id uuid default null,p_day date default null,p_room_id uuid default null,p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; day_start timestamptz; cursor_row public.room_turnaround_tasks;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('room-turnaround',p_hotel_id,d.id,'read')) then
  return workstel_private.room_turnaround_denied(p_hotel_id,p_department_id,p_room_id,'room-turnaround.tasks.list');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 or (p_day is null and p_room_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 day_start:=p_day::timestamp at time zone 'Asia/Jakarta';
 if p_after is not null then select * into cursor_row from public.room_turnaround_tasks where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(row_data order by (row_data->>'started_at')::timestamptz desc,row_data->>'id' desc),'[]'::jsonb) into result from (
  select workstel_private.room_turnaround_task_json(t)||jsonb_build_object('room_number',r.room_number) as row_data
  from public.room_turnaround_tasks t join public.room_turnaround_rooms r on r.id=t.room_id
  where t.hotel_id=p_hotel_id and workstel_private.module_allowed('room-turnaround',t.hotel_id,t.department_id,'read')
  and (p_department_id is null or t.department_id=p_department_id)
  and (p_room_id is null or t.room_id=p_room_id)
  and (p_day is null or (t.started_at>=day_start and t.started_at<day_start+interval '1 day'))
  and (cursor_row.id is null or (t.started_at,t.id)<(cursor_row.started_at,cursor_row.id))
  order by t.started_at desc,t.id desc limit p_limit
 ) rows_data;
 perform workstel_private.room_turnaround_audit(p_hotel_id,p_department_id,p_room_id,'room-turnaround.tasks.list');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

-- One day's cleaning times: rooms cleaned and average per kind of cleaning and per attendant.
create function public.room_turnaround_summary(p_hotel_id uuid,p_department_id uuid default null,p_day date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_day date:=coalesce(p_day,(now() at time zone 'Asia/Jakarta')::date); day_start timestamptz; types jsonb; people jsonb; totals jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('room-turnaround',p_hotel_id,d.id,'read')) then
  return workstel_private.room_turnaround_denied(p_hotel_id,p_department_id,null,'room-turnaround.summary');
 end if;
 day_start:=target_day::timestamp at time zone 'Asia/Jakarta';
 with day_tasks as (
  select t.task_type,t.attendant_id,t.duration_seconds,t.room_id from public.room_turnaround_tasks t
  where t.hotel_id=p_hotel_id and t.status='done' and (p_department_id is null or t.department_id=p_department_id)
  and workstel_private.module_allowed('room-turnaround',t.hotel_id,t.department_id,'read')
  and t.started_at>=day_start and t.started_at<day_start+interval '1 day')
 select
  (select jsonb_build_object('done',count(*),'rooms',count(distinct room_id),'avg_seconds',coalesce(round(avg(duration_seconds))::integer,0)) from day_tasks),
  (select coalesce(jsonb_object_agg(x.task_type,jsonb_build_object('done',x.done,'avg_seconds',x.avg_seconds,'max_seconds',x.max_seconds)),'{}'::jsonb) from (
   select task_type,count(*) as done,round(avg(duration_seconds))::integer as avg_seconds,max(duration_seconds) as max_seconds from day_tasks group by task_type) x),
  (select coalesce(jsonb_agg(jsonb_build_object('email',x.email,'done',x.done,'avg_seconds',x.avg_seconds,'total_seconds',x.total_seconds) order by x.done desc,x.email),'[]'::jsonb) from (
   select coalesce(u.email,'') as email,count(*) as done,round(avg(h.duration_seconds))::integer as avg_seconds,sum(h.duration_seconds)::integer as total_seconds
   from day_tasks h left join auth.users u on u.id=h.attendant_id group by u.email) x)
 into totals,types,people;
 perform workstel_private.room_turnaround_audit(p_hotel_id,p_department_id,null,'room-turnaround.summary');
 return jsonb_build_object('data',jsonb_build_object('totals',totals,'task_types',types,'attendants',people),
  'meta',jsonb_build_object('day',target_day,'now',clock_timestamp()));
end$$;

revoke all on function public.room_turnaround_rooms_list(uuid,uuid,boolean) from public,anon;
revoke all on function public.room_turnaround_room_save(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.room_turnaround_rooms_import(uuid,uuid,jsonb) from public,anon;
revoke all on function public.room_turnaround_task_start(uuid,uuid,text) from public,anon;
revoke all on function public.room_turnaround_task_update(uuid,uuid,text) from public,anon;
revoke all on function public.room_turnaround_tasks_list(uuid,uuid,date,uuid,uuid,integer) from public,anon;
revoke all on function public.room_turnaround_summary(uuid,uuid,date) from public,anon;
grant execute on function public.room_turnaround_rooms_list(uuid,uuid,boolean) to authenticated;
grant execute on function public.room_turnaround_room_save(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.room_turnaround_rooms_import(uuid,uuid,jsonb) to authenticated;
grant execute on function public.room_turnaround_task_start(uuid,uuid,text) to authenticated;
grant execute on function public.room_turnaround_task_update(uuid,uuid,text) to authenticated;
grant execute on function public.room_turnaround_tasks_list(uuid,uuid,date,uuid,uuid,integer) to authenticated;
grant execute on function public.room_turnaround_summary(uuid,uuid,date) to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611040013') on conflict do nothing;
notify pgrst,'reload schema';
commit;
