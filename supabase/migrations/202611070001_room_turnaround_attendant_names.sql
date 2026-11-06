begin;
-- Room Turnaround shows who cleaned a room by the attendant's profile display name.
-- This is the one exception to the self-only profile rule (202611050002): only the display
-- name leaves the profile, never the job title, extension or locale, and only inside Room
-- Turnaround task rows and the daily summary, which the caller may already read and which
-- have always carried the attendant's email. Without a display name the part of the email
-- before @ is used, which is what the screens showed before.
create function workstel_private.staff_display_name(p_user uuid)
returns text language sql stable security definer set search_path='' as $$
 select coalesce(
  (select p.display_name from workstel_private.user_profiles p where p.user_id=p_user),
  nullif(split_part((select u.email from auth.users u where u.id=p_user),'@',1),''),
  '') $$;
revoke all on function workstel_private.staff_display_name(uuid) from public,anon,authenticated;

-- Same row as before, plus attendant_name. Existing grants survive create or replace.
create or replace function workstel_private.room_turnaround_task_json(p_task public.room_turnaround_tasks)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_task.id,'room_id',p_task.room_id,'task_type',p_task.task_type,'status',p_task.status,
  'attendant_email',coalesce((select u.email from auth.users u where u.id=p_task.attendant_id),''),
  'attendant_name',workstel_private.staff_display_name(p_task.attendant_id),'mine',p_task.attendant_id=auth.uid(),
  'started_at',p_task.started_at,'paused_at',p_task.paused_at,'paused_seconds',p_task.paused_seconds,
  'finished_at',p_task.finished_at,'duration_seconds',p_task.duration_seconds) $$;

-- The per-attendant totals group by person, not email, and carry the display name.
create or replace function public.room_turnaround_summary(p_hotel_id uuid,p_department_id uuid default null,p_day date default null)
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
  (select coalesce(jsonb_agg(jsonb_build_object('email',x.email,'name',x.name,'done',x.done,'avg_seconds',x.avg_seconds,'total_seconds',x.total_seconds) order by x.done desc,x.email),'[]'::jsonb) from (
   select coalesce((select u.email from auth.users u where u.id=h.attendant_id),'') as email,
    workstel_private.staff_display_name(h.attendant_id) as name,
    count(*) as done,round(avg(h.duration_seconds))::integer as avg_seconds,sum(h.duration_seconds)::integer as total_seconds
   from day_tasks h group by h.attendant_id) x)
 into totals,types,people;
 perform workstel_private.room_turnaround_audit(p_hotel_id,p_department_id,null,'room-turnaround.summary');
 return jsonb_build_object('data',jsonb_build_object('totals',totals,'task_types',types,'attendants',people),
  'meta',jsonb_build_object('day',target_day,'now',clock_timestamp()));
end$$;

insert into workstel_private.schema_migrations(version) values ('202611070001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
