begin;
-- Casual Attendance: supervisors record daily attendance for casual, trainee and daily staff.
-- The people are records, not Workstel accounts. Check-in and check-out times come from the
-- server clock; managers correct them with a reason, and every correction is kept.
alter table workstel_private.installed_modules drop constraint installed_modules_module_id_check;
alter table workstel_private.module_access drop constraint module_access_module_id_check;
alter table workstel_private.installed_modules add constraint installed_modules_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','room-turnaround','casual-attendance'));
alter table workstel_private.module_access add constraint module_access_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm','room-turnaround','casual-attendance'));

create table public.casual_attendance_people(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 80),
 person_type text not null check(person_type in ('casual','trainee','daily')),
 origin text not null default '' check(length(origin)<=100),
 start_date date not null,end_date date check(end_date is null or end_date>=start_date),
 shift text not null check(shift in ('morning','afternoon','night')),
 notes text not null default '' check(length(notes)<=500),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index casual_attendance_people_scope_idx on public.casual_attendance_people(hotel_id,department_id,status,lower(name),id);

create table public.casual_attendance_records(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 person_id uuid not null references public.casual_attendance_people(id),work_date date not null,
 status text not null check(status in ('present','leave','sick','absent')),
 shift text not null check(shift in ('morning','afternoon','night')),
 check_in timestamptz,check_out timestamptz,
 note text not null default '' check(length(note)<=200),
 corrected boolean not null default false,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 unique(person_id,work_date),
 check((status='present')=(check_in is not null)),
 check(check_out is null or check_out>check_in),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index casual_attendance_records_day_idx on public.casual_attendance_records(hotel_id,work_date);

-- Every correction keeps the times it replaced. Rows are append-only.
create table public.casual_attendance_corrections(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 person_id uuid not null references public.casual_attendance_people(id),work_date date not null,
 previous_status text,previous_check_in timestamptz,previous_check_out timestamptz,
 check_in timestamptz not null,check_out timestamptz,
 reason text not null check(length(trim(reason)) between 1 and 200),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id)
);
create index casual_attendance_corrections_person_idx on public.casual_attendance_corrections(person_id,work_date);
alter table public.casual_attendance_people enable row level security;
alter table public.casual_attendance_records enable row level security;
alter table public.casual_attendance_corrections enable row level security;
revoke all on public.casual_attendance_people,public.casual_attendance_records,public.casual_attendance_corrections from public,anon,authenticated;

create function workstel_private.reject_casual_attendance_correction_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'Attendance corrections are append-only';end$$;
create trigger casual_attendance_corrections_append_only before update or delete on public.casual_attendance_corrections
 for each row execute function workstel_private.reject_casual_attendance_correction_change();

-- Hotel calendar day and shift starts in Asia/Jakarta (no daylight saving).
create function workstel_private.casual_attendance_today()
returns date language sql stable set search_path='' as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
create function workstel_private.casual_attendance_shift_start(p_day date,p_shift text)
returns timestamptz language sql stable set search_path='' as $$
 select (p_day+case p_shift when 'morning' then time '07:00' when 'afternoon' then time '15:00' else time '23:00' end) at time zone 'Asia/Jakarta' $$;
-- Late means more than five whole minutes after the shift start, as in the frontend.
create function workstel_private.casual_attendance_is_late(p_day date,p_shift text,p_check_in timestamptz)
returns boolean language sql stable set search_path='' as $$
 select p_check_in is not null and floor(extract(epoch from p_check_in-workstel_private.casual_attendance_shift_start(p_day,p_shift))/60)>5 $$;
-- A strict YYYY-MM-DD JSON string as a date, or null.
create function workstel_private.casual_attendance_date(p_value jsonb)
returns date language plpgsql immutable set search_path='' as $$
declare value date;
begin
 if jsonb_typeof(p_value) is distinct from 'string' or p_value#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
 value:=to_date(p_value#>>'{}','YYYY-MM-DD');
 -- to_date rolls 2026-02-30 over to March; the round trip rejects it.
 if to_char(value,'YYYY-MM-DD')<>p_value#>>'{}' then return null;end if;
 return value;
exception when others then return null;
end$$;
create function workstel_private.casual_attendance_record_json(r public.casual_attendance_records)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'person_id',r.person_id,'work_date',to_char(r.work_date,'YYYY-MM-DD'),'status',r.status,'shift',r.shift,
  'check_in',r.check_in,'check_out',r.check_out,'note',r.note,'corrected',r.corrected,'version',r.version) $$;
create function workstel_private.casual_attendance_scheduled(p public.casual_attendance_people,p_day date)
returns boolean language sql stable set search_path='' as $$
 select p.status='active' and p.start_date<=p_day and (p.end_date is null or p.end_date>=p_day) $$;
revoke all on function workstel_private.casual_attendance_today() from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_shift_start(date,text) from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_is_late(date,text,timestamptz) from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_date(jsonb) from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_record_json(public.casual_attendance_records) from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_scheduled(public.casual_attendance_people,date) from public,anon,authenticated;

create function public.casual_attendance_list_people(p_hotel_id uuid,p_department_id uuid default null,p_type text default null,p_period text default 'current',p_search text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; after_name text; today date:=workstel_private.casual_attendance_today();
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('casual-attendance',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.person.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_period is null or p_period not in ('current','ended','archived','all') or (p_type is not null and p_type not in ('casual','trainee','daily'))
  or p_limit is null or p_limit<1 or p_limit>100 or p_search is null or length(p_search)>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select lower(name) into after_name from public.casual_attendance_people where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by lower(row_data.name),row_data.id),'[]'::jsonb) into result from (
  select p.id,p.hotel_id,p.department_id,d.name as department_name,p.name,p.person_type,p.origin,
   to_char(p.start_date,'YYYY-MM-DD') as start_date,to_char(p.end_date,'YYYY-MM-DD') as end_date,p.shift,p.notes,p.status,p.version,p.updated_at
  from public.casual_attendance_people p join public.workstel_departments d on d.hotel_id=p.hotel_id and d.id=p.department_id
  where p.hotel_id=p_hotel_id and workstel_private.module_allowed('casual-attendance',p.hotel_id,p.department_id,'read')
  and (p_department_id is null or p.department_id=p_department_id)
  and (p_type is null or p.person_type=p_type)
  and case p_period
   when 'current' then p.status='active' and (p.end_date is null or p.end_date>=today)
   when 'ended' then p.status='active' and p.end_date<today
   when 'archived' then p.status='archived'
   else true end
  and (p_search='' or position(lower(p_search) in lower(p.name||' '||p.origin))>0)
  and (after_name is null or (lower(p.name),p.id)>(after_name,p_after))
  order by lower(p.name),p.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.person.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

create function public.casual_attendance_save_person(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_person_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; existing public.casual_attendance_people; starts date; ends date;
begin
 if not workstel_private.module_allowed('casual-attendance',p_hotel_id,p_department_id,'manage') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_person_id,'casual-attendance.person.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_person_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_person_id is not null then
  select * into existing from public.casual_attendance_people where id=p_person_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.module_allowed('casual-attendance',existing.hotel_id,existing.department_id,'manage') then
   insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_person_id,'casual-attendance.person.write','denied');
   return jsonb_build_object('error','ACCESS_DENIED');
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','type','origin','startDate','endDate','shift','notes'))
   or jsonb_typeof(p_input->'name') is distinct from 'string' or length(trim(p_input->>'name')) not between 1 and 80
   or jsonb_typeof(p_input->'type') is distinct from 'string' or p_input->>'type' not in ('casual','trainee','daily')
   or jsonb_typeof(p_input->'shift') is distinct from 'string' or p_input->>'shift' not in ('morning','afternoon','night')
   or (p_input ? 'origin' and (jsonb_typeof(p_input->'origin')<>'string' or length(trim(p_input->>'origin'))>100))
   or (p_input ? 'notes' and (jsonb_typeof(p_input->'notes')<>'string' or length(trim(p_input->>'notes'))>500))
   then return jsonb_build_object('error','INVALID_INPUT');end if;
  starts:=workstel_private.casual_attendance_date(p_input->'startDate');
  ends:=case when p_input->'endDate' is null or jsonb_typeof(p_input->'endDate')='null' then null else workstel_private.casual_attendance_date(p_input->'endDate') end;
  if starts is null or (jsonb_typeof(p_input->'endDate')='string' and ends is null) or ends<starts then return jsonb_build_object('error','INVALID_INPUT');end if;
  -- Attendance stays with the department it was recorded in.
  if p_person_id is not null and existing.department_id<>p_department_id and exists(select 1 from public.casual_attendance_records r where r.person_id=p_person_id) then
   return jsonb_build_object('error','DEPARTMENT_LOCKED');
  end if;
  if p_person_id is null then
   insert into public.casual_attendance_people(hotel_id,department_id,name,person_type,origin,start_date,end_date,shift,notes,created_by,updated_by)
   values(p_hotel_id,p_department_id,trim(p_input->>'name'),p_input->>'type',trim(coalesce(p_input->>'origin','')),starts,ends,p_input->>'shift',trim(coalesce(p_input->>'notes','')),auth.uid(),auth.uid())
   returning * into person;
  else
   update public.casual_attendance_people set department_id=p_department_id,name=trim(p_input->>'name'),person_type=p_input->>'type',origin=trim(coalesce(p_input->>'origin','')),
    start_date=starts,end_date=ends,shift=p_input->>'shift',notes=trim(coalesce(p_input->>'notes','')),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
   where id=p_person_id returning * into person;
  end if;
 else
  update public.casual_attendance_people set status=case when p_action='archive' then 'archived' else 'active' end,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_person_id returning * into person;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,person.department_id,person.id,'casual-attendance.person.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('id',person.id,'version',person.version));
end$$;

-- Everyone expected on a day, and anyone with a record that day, with that record.
create function public.casual_attendance_day(p_hotel_id uuid,p_department_id uuid default null,p_day date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('casual-attendance',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.day.read','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_day is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) - 'shift_order' order by row_data.shift_order,lower(row_data.name),row_data.id),'[]'::jsonb) into result from (
  select p.id,p.department_id,d.name as department_name,p.name,p.person_type,p.origin,p.shift,
   case p.shift when 'morning' then 1 when 'afternoon' then 2 else 3 end as shift_order,
   case when r.id is null then null else workstel_private.casual_attendance_record_json(r) end as record
  from public.casual_attendance_people p
  join public.workstel_departments d on d.hotel_id=p.hotel_id and d.id=p.department_id
  left join public.casual_attendance_records r on r.person_id=p.id and r.work_date=p_day
  where p.hotel_id=p_hotel_id and workstel_private.module_allowed('casual-attendance',p.hotel_id,p.department_id,'read')
  and (p_department_id is null or p.department_id=p_department_id)
  and (workstel_private.casual_attendance_scheduled(p,p_day) or r.id is not null)
  order by shift_order,lower(p.name),p.id limit 500
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.day.read','success');
 return jsonb_build_object('data',result);
end$$;

-- check_in and check_out use the server clock. leave, sick and absent create the day's record;
-- reopen undoes a check-out and reset removes a record that has no check-out.
create function public.casual_attendance_mark(p_hotel_id uuid,p_person_id uuid,p_day date,p_action text,p_expected_version integer default null,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; rec public.casual_attendance_records; has_record boolean; today date:=workstel_private.casual_attendance_today();
begin
 select * into person from public.casual_attendance_people where id=p_person_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('casual-attendance',person.hotel_id,person.department_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,person.department_id,p_person_id,'casual-attendance.attendance.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_day is null or p_action is null or p_action not in ('check_in','check_out','leave','sick','absent','reopen','reset')
  or p_note is null or length(trim(p_note))>200 then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into rec from public.casual_attendance_records where person_id=p_person_id and work_date=p_day for update;
 has_record:=found;
 if (case when has_record then rec.version end) is distinct from p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 if p_action in ('check_in','leave','sick','absent') then
  if has_record then return jsonb_build_object('error','ALREADY_MARKED');end if;
  if not workstel_private.casual_attendance_scheduled(person,p_day) then return jsonb_build_object('error','NOT_SCHEDULED');end if;
  -- Check-in is open today, and yesterday for a night shift; away marks a week back to a month ahead.
  if (p_action='check_in' and p_day not in (today,today-1)) or (p_action<>'check_in' and (p_day<today-7 or p_day>today+30)) then
   return jsonb_build_object('error','DAY_CLOSED');
  end if;
  begin
   insert into public.casual_attendance_records(hotel_id,department_id,person_id,work_date,status,shift,check_in,note,created_by,updated_by)
   values(person.hotel_id,person.department_id,person.id,p_day,case when p_action='check_in' then 'present' else p_action end,person.shift,
    case when p_action='check_in' then clock_timestamp() end,case when p_action='check_in' then '' else trim(p_note) end,auth.uid(),auth.uid())
   returning * into rec;
  exception when unique_violation then
   return jsonb_build_object('error','VERSION_CONFLICT');
  end;
 elsif not has_record then
  return jsonb_build_object('error','NOT_CHECKED_IN');
 elsif p_action='check_out' then
  if rec.status<>'present' or rec.check_out is not null then return jsonb_build_object('error','NOT_CHECKED_IN');end if;
  update public.casual_attendance_records set check_out=greatest(clock_timestamp(),rec.check_in+interval '1 second'),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=rec.id returning * into rec;
 elsif p_action='reopen' then
  if rec.check_out is null then return jsonb_build_object('error','NOT_CHECKED_IN');end if;
  update public.casual_attendance_records set check_out=null,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=rec.id returning * into rec;
 else
  if rec.check_out is not null then return jsonb_build_object('error','RECORD_CLOSED');end if;
  delete from public.casual_attendance_records where id=rec.id;
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,rec.id,'casual-attendance.attendance.reset','success');
  return jsonb_build_object('data',null);
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome)
 values(auth.uid(),person.hotel_id,person.department_id,rec.id,'casual-attendance.attendance.'||replace(p_action,'_','-'),'success');
 return jsonb_build_object('data',workstel_private.casual_attendance_record_json(rec));
end$$;

-- Manager correction: sets the day's times from hotel wall-clock HH:MM. A check-out earlier
-- than the check-in is on the next day. The replaced values are kept in the corrections table.
create function public.casual_attendance_correct(p_hotel_id uuid,p_person_id uuid,p_day date,p_check_in text,p_check_out text,p_reason text,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; rec public.casual_attendance_records; has_record boolean; in_at timestamptz; out_at timestamptz;
 today date:=workstel_private.casual_attendance_today(); clock text:='^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
 select * into person from public.casual_attendance_people where id=p_person_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('casual-attendance',person.hotel_id,person.department_id,'manage') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,person.department_id,p_person_id,'casual-attendance.attendance.correct','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_day is null or p_check_in is null or p_check_in !~ clock or (p_check_out is not null and p_check_out !~ clock)
  or p_reason is null or length(trim(p_reason)) not between 1 and 200 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_day>today or p_day<today-62 then return jsonb_build_object('error','DAY_CLOSED');end if;
 in_at:=(p_day+p_check_in::time) at time zone 'Asia/Jakarta';
 if p_check_out is not null then
  out_at:=(p_day+p_check_out::time+case when p_check_out::time<=p_check_in::time then interval '1 day' else interval '0' end) at time zone 'Asia/Jakarta';
 end if;
 if in_at>now() or out_at>now() or out_at-in_at>interval '16 hours' then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into rec from public.casual_attendance_records where person_id=p_person_id and work_date=p_day for update;
 has_record:=found;
 if (case when has_record then rec.version end) is distinct from p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 if not has_record and not workstel_private.casual_attendance_scheduled(person,p_day) then return jsonb_build_object('error','NOT_SCHEDULED');end if;
 insert into public.casual_attendance_corrections(hotel_id,department_id,person_id,work_date,previous_status,previous_check_in,previous_check_out,check_in,check_out,reason,created_by)
 values(person.hotel_id,person.department_id,person.id,p_day,rec.status,rec.check_in,rec.check_out,in_at,out_at,trim(p_reason),auth.uid());
 if has_record then
  update public.casual_attendance_records set status='present',check_in=in_at,check_out=out_at,corrected=true,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=rec.id returning * into rec;
 else
  begin
   insert into public.casual_attendance_records(hotel_id,department_id,person_id,work_date,status,shift,check_in,check_out,corrected,created_by,updated_by)
   values(person.hotel_id,person.department_id,person.id,p_day,'present',person.shift,in_at,out_at,true,auth.uid(),auth.uid())
   returning * into rec;
  exception when unique_violation then
   return jsonb_build_object('error','VERSION_CONFLICT');
  end;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,rec.id,'casual-attendance.attendance.correct','success');
 return jsonb_build_object('data',workstel_private.casual_attendance_record_json(rec));
end$$;

-- Per-person totals for at most 62 days. An export is audited separately from viewing.
create function public.casual_attendance_recap(p_hotel_id uuid,p_department_id uuid default null,p_type text default null,p_from date default null,p_to date default null,p_purpose text default 'view')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; audit_action text:='casual-attendance.recap.'||case when p_purpose='export' then 'export' else 'read' end;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('casual-attendance',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,audit_action,'denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_purpose is null or p_purpose not in ('view','export') or (p_type is not null and p_type not in ('casual','trainee','daily'))
  or p_from is null or p_to is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_from>p_to or p_to-p_from>61 then return jsonb_build_object('error','RANGE_TOO_LONG');end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by lower(row_data.name),row_data.person_id),'[]'::jsonb) into result from (
  select p.id as person_id,p.name,p.person_type,p.origin,d.name as department_name,
   (count(*) filter (where r.status='present'))::integer as present,
   (count(*) filter (where r.status='present' and workstel_private.casual_attendance_is_late(r.work_date,r.shift,r.check_in)))::integer as late,
   (count(*) filter (where r.status='leave'))::integer as leave,
   (count(*) filter (where r.status='sick'))::integer as sick,
   (count(*) filter (where r.status='absent'))::integer as absent,
   coalesce(sum(floor(extract(epoch from r.check_out-r.check_in)/60)) filter (where r.check_out is not null),0)::integer as minutes
  from public.casual_attendance_people p
  join public.workstel_departments d on d.hotel_id=p.hotel_id and d.id=p.department_id
  join public.casual_attendance_records r on r.person_id=p.id and r.work_date between p_from and p_to
  where p.hotel_id=p_hotel_id and workstel_private.module_allowed('casual-attendance',p.hotel_id,p.department_id,'read')
  and (p_department_id is null or p.department_id=p_department_id)
  and (p_type is null or p.person_type=p_type)
  group by p.id,p.name,p.person_type,p.origin,d.name
  order by lower(p.name),p.id limit 500
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,audit_action,'success');
 return jsonb_build_object('data',result);
end$$;

revoke all on function public.casual_attendance_list_people(uuid,uuid,text,text,text,uuid,integer) from public,anon;
revoke all on function public.casual_attendance_save_person(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.casual_attendance_day(uuid,uuid,date) from public,anon;
revoke all on function public.casual_attendance_mark(uuid,uuid,date,text,integer,text) from public,anon;
revoke all on function public.casual_attendance_correct(uuid,uuid,date,text,text,text,integer) from public,anon;
revoke all on function public.casual_attendance_recap(uuid,uuid,text,date,date,text) from public,anon;
grant execute on function public.casual_attendance_list_people(uuid,uuid,text,text,text,uuid,integer) to authenticated;
grant execute on function public.casual_attendance_save_person(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.casual_attendance_day(uuid,uuid,date) to authenticated;
grant execute on function public.casual_attendance_mark(uuid,uuid,date,text,integer,text) to authenticated;
grant execute on function public.casual_attendance_correct(uuid,uuid,date,text,text,text,integer) to authenticated;
grant execute on function public.casual_attendance_recap(uuid,uuid,text,date,date,text) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('casual-attendance',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611100001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
