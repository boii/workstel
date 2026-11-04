begin;
-- Housekeeping is narrowed to its main job: timing how long each room takes to clean.
-- Room status, inspections and declined service are removed. The tables were empty when
-- this was written; the guard stops the migration instead of discarding recorded data.
do $$
begin
 if exists(select 1 from public.housekeeping_inspections) or exists(select 1 from public.housekeeping_tasks where status in ('dnd','refused') or task_type not in ('departure','make-up')) then
  raise exception 'Housekeeping holds inspections or task types that this migration would remove';
 end if;
end$$;

drop function public.housekeeping_inspect(uuid,uuid,text,integer,text);
drop function public.housekeeping_room_set_status(uuid,uuid,text,integer,text);
drop function public.housekeeping_task_start(uuid,uuid,text,text,text);
drop function public.housekeeping_task_update(uuid,uuid,text,text,text);
drop function public.housekeeping_rooms_list(uuid,uuid,boolean);
drop function public.housekeeping_tasks_list(uuid,uuid,date,uuid,uuid,integer);
drop function public.housekeeping_summary(uuid,uuid,date);
drop function workstel_private.housekeeping_task_json(public.housekeeping_tasks);
drop table public.housekeeping_inspections;
drop function workstel_private.reject_housekeeping_inspection_change();

alter table public.housekeeping_rooms drop column status,drop column status_note,drop column status_changed_at;
alter table public.housekeeping_tasks drop constraint housekeeping_tasks_task_type_check;
alter table public.housekeeping_tasks add constraint housekeeping_tasks_task_type_check check(task_type in ('departure','make-up','other'));
alter table public.housekeeping_tasks drop constraint housekeeping_tasks_status_check;
alter table public.housekeeping_tasks add constraint housekeeping_tasks_status_check check(status in ('active','paused','done','cancelled'));
alter table public.housekeeping_tasks drop column notes;

create function workstel_private.housekeeping_task_json(p_task public.housekeeping_tasks)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_task.id,'room_id',p_task.room_id,'task_type',p_task.task_type,'status',p_task.status,
  'attendant_email',coalesce((select u.email from auth.users u where u.id=p_task.attendant_id),''),'mine',p_task.attendant_id=auth.uid(),
  'started_at',p_task.started_at,'paused_at',p_task.paused_at,'paused_seconds',p_task.paused_seconds,
  'finished_at',p_task.finished_at,'duration_seconds',p_task.duration_seconds) $$;
revoke all on function workstel_private.housekeeping_task_json(public.housekeeping_tasks) from public,anon,authenticated;

-- All rooms the caller can read, each with its open task and the last cleaning time.
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
   'room_number',r.room_number,'floor',r.floor,'room_type',r.room_type,'archived',r.archived,'version',r.version,
   'open_task',(select workstel_private.housekeeping_task_json(t) from public.housekeeping_tasks t where t.room_id=r.id and t.status in ('active','paused')),
   'last_done',(select jsonb_build_object('finished_at',t.finished_at,'duration_seconds',t.duration_seconds,'task_type',t.task_type)
     from public.housekeeping_tasks t where t.room_id=r.id and t.status='done' order by t.finished_at desc limit 1)) as row_data,
   lpad(upper(r.floor),10,'0') as sort_floor,lpad(upper(r.room_number),10,'0') as sort_number
  from public.housekeeping_rooms r join public.workstel_departments d on d.hotel_id=r.hotel_id and d.id=r.department_id
  where r.hotel_id=p_hotel_id and workstel_private.module_allowed('housekeeping',r.hotel_id,r.department_id,'read')
  and (p_department_id is null or r.department_id=p_department_id) and (p_include_archived or not r.archived)
  limit 1000
 ) x;
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,null,'housekeeping.rooms.list');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('now',clock_timestamp()));
end$$;

-- Starts the caller's timer on a room. One open task per room and per attendant.
create function public.housekeeping_task_start(p_hotel_id uuid,p_room_id uuid,p_task_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare room public.housekeeping_rooms; task public.housekeeping_tasks;
begin
 select * into room from public.housekeeping_rooms where id=p_room_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('housekeeping',room.hotel_id,room.department_id,'write') then
  return workstel_private.housekeeping_denied(p_hotel_id,room.department_id,p_room_id,'housekeeping.write');
 end if;
 if p_task_type is null or p_task_type not in ('departure','make-up','other') or room.archived then return jsonb_build_object('error','INVALID_INPUT');end if;
 if exists(select 1 from public.housekeeping_tasks t where t.room_id=room.id and t.status in ('active','paused')) then return jsonb_build_object('error','ROOM_BUSY');end if;
 if exists(select 1 from public.housekeeping_tasks t where t.attendant_id=auth.uid() and t.status in ('active','paused')) then return jsonb_build_object('error','ATTENDANT_BUSY');end if;
 begin
  insert into public.housekeeping_tasks(hotel_id,department_id,room_id,task_type,attendant_id)
  values(room.hotel_id,room.department_id,room.id,p_task_type,auth.uid()) returning * into task;
 exception when unique_violation then return jsonb_build_object('error','ROOM_BUSY');
 end;
 perform workstel_private.housekeeping_audit(p_hotel_id,room.department_id,task.id,'housekeeping.task.start');
 return jsonb_build_object('data',workstel_private.housekeeping_task_json(task));
end$$;

-- pause, resume, finish and cancel. The attendant acts on their own task; a supervisor
-- (manage) may act on anyone's. Durations come from the server clock and exclude pauses.
create function public.housekeeping_task_update(p_hotel_id uuid,p_task_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task public.housekeeping_tasks; now_at timestamptz:=clock_timestamp(); paused integer;
begin
 select * into task from public.housekeeping_tasks where id=p_task_id and hotel_id=p_hotel_id for update;
 if not found or not (
  (task.attendant_id=auth.uid() and workstel_private.module_allowed('housekeeping',task.hotel_id,task.department_id,'write'))
  or workstel_private.module_allowed('housekeeping',task.hotel_id,task.department_id,'manage')) then
  return workstel_private.housekeeping_denied(p_hotel_id,task.department_id,p_task_id,'housekeeping.write');
 end if;
 if p_action is null or p_action not in ('pause','resume','finish','cancel') then return jsonb_build_object('error','INVALID_INPUT');end if;
 if task.status not in ('active','paused') or (p_action='pause' and task.status<>'active') or (p_action='resume' and task.status<>'paused') then
  return jsonb_build_object('error','TASK_CLOSED');
 end if;
 paused:=task.paused_seconds+case when task.status='paused' then floor(extract(epoch from now_at-task.paused_at))::integer else 0 end;
 if p_action='pause' then
  update public.housekeeping_tasks set status='paused',paused_at=now_at where id=task.id returning * into task;
 elsif p_action='resume' then
  update public.housekeeping_tasks set status='active',paused_at=null,paused_seconds=paused where id=task.id returning * into task;
 else
  update public.housekeeping_tasks set status=case when p_action='cancel' then 'cancelled' else 'done' end,paused_at=null,paused_seconds=paused,finished_at=now_at,
   duration_seconds=case when p_action='cancel' then null else greatest(0,floor(extract(epoch from now_at-started_at))::integer-paused) end
  where id=task.id returning * into task;
 end if;
 perform workstel_private.housekeeping_audit(p_hotel_id,task.department_id,task.id,'housekeeping.task.'||case when p_action='finish' then 'done' else p_action end);
 return jsonb_build_object('data',workstel_private.housekeeping_task_json(task));
end$$;

-- Tasks of one hotel calendar day (Asia/Jakarta) or of one room, newest first.
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
  select workstel_private.housekeeping_task_json(t)||jsonb_build_object('room_number',r.room_number) as row_data
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

-- One day's cleaning times: rooms cleaned and average per task type and per attendant.
create function public.housekeeping_summary(p_hotel_id uuid,p_department_id uuid default null,p_day date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_day date:=coalesce(p_day,(now() at time zone 'Asia/Jakarta')::date); day_start timestamptz; types jsonb; people jsonb; totals jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('housekeeping',p_hotel_id,d.id,'read')) then
  return workstel_private.housekeeping_denied(p_hotel_id,p_department_id,null,'housekeeping.summary');
 end if;
 day_start:=target_day::timestamp at time zone 'Asia/Jakarta';
 with day_tasks as (
  select t.task_type,t.attendant_id,t.duration_seconds,t.room_id from public.housekeeping_tasks t
  where t.hotel_id=p_hotel_id and t.status='done' and (p_department_id is null or t.department_id=p_department_id)
  and workstel_private.module_allowed('housekeeping',t.hotel_id,t.department_id,'read')
  and t.started_at>=day_start and t.started_at<day_start+interval '1 day')
 select
  (select jsonb_build_object('done',count(*),'rooms',count(distinct room_id),'avg_seconds',coalesce(round(avg(duration_seconds))::integer,0)) from day_tasks),
  (select coalesce(jsonb_object_agg(x.task_type,jsonb_build_object('done',x.done,'avg_seconds',x.avg_seconds,'max_seconds',x.max_seconds)),'{}'::jsonb) from (
   select task_type,count(*) as done,round(avg(duration_seconds))::integer as avg_seconds,max(duration_seconds) as max_seconds from day_tasks group by task_type) x),
  (select coalesce(jsonb_agg(jsonb_build_object('email',x.email,'done',x.done,'avg_seconds',x.avg_seconds,'total_seconds',x.total_seconds) order by x.done desc,x.email),'[]'::jsonb) from (
   select coalesce(u.email,'') as email,count(*) as done,round(avg(h.duration_seconds))::integer as avg_seconds,sum(h.duration_seconds)::integer as total_seconds
   from day_tasks h left join auth.users u on u.id=h.attendant_id group by u.email) x)
 into totals,types,people;
 perform workstel_private.housekeeping_audit(p_hotel_id,p_department_id,null,'housekeeping.summary');
 return jsonb_build_object('data',jsonb_build_object('totals',totals,'task_types',types,'attendants',people),
  'meta',jsonb_build_object('day',target_day,'now',clock_timestamp()));
end$$;

revoke all on function public.housekeeping_rooms_list(uuid,uuid,boolean) from public,anon;
revoke all on function public.housekeeping_task_start(uuid,uuid,text) from public,anon;
revoke all on function public.housekeeping_task_update(uuid,uuid,text) from public,anon;
revoke all on function public.housekeeping_tasks_list(uuid,uuid,date,uuid,uuid,integer) from public,anon;
revoke all on function public.housekeeping_summary(uuid,uuid,date) from public,anon;
grant execute on function public.housekeeping_rooms_list(uuid,uuid,boolean) to authenticated;
grant execute on function public.housekeeping_task_start(uuid,uuid,text) to authenticated;
grant execute on function public.housekeeping_task_update(uuid,uuid,text) to authenticated;
grant execute on function public.housekeeping_tasks_list(uuid,uuid,date,uuid,uuid,integer) to authenticated;
grant execute on function public.housekeeping_summary(uuid,uuid,date) to authenticated;

update workstel_private.installed_modules set schema_version=2 where module_id='housekeeping';
insert into workstel_private.schema_migrations(version) values ('202611040012') on conflict do nothing;
notify pgrst,'reload schema';
commit;
