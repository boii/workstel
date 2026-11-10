begin;
-- Casual Attendance self check-in, phase 1 (src/modules/casual-attendance/SELF_CHECK_IN.md).
-- A manager links a signed-in account to one person with a one-time code. The linked account
-- can only check that person in and out; it gets no staff_access and no module grant. Each
-- department switches self check-in on and chooses when a supervisor must review it.

alter table public.casual_attendance_records
 add column source text not null default 'supervisor' check(source in ('supervisor','self')),
 add column verification text check(verification in ('verified','needs_review','unverified','rejected')),
 add column reviewed_by uuid references auth.users(id),
 add column reviewed_at timestamptz,
 add column review_note text not null default '' check(length(review_note)<=200);

create table public.casual_attendance_links(
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.casual_attendance_people(id),
 user_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 unlinked_at timestamptz,unlinked_by uuid references auth.users(id),
 check((unlinked_at is null)=(unlinked_by is null))
);
-- One active link per person and per account; unlinked rows stay as history.
create unique index casual_attendance_links_person_idx on public.casual_attendance_links(person_id) where unlinked_at is null;
create unique index casual_attendance_links_user_idx on public.casual_attendance_links(user_id) where unlinked_at is null;

-- Only a hash of the code is kept. A new code replaces the person's unused one.
create table public.casual_attendance_link_codes(
 person_id uuid primary key references public.casual_attendance_people(id),
 code_hash bytea not null unique,expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id)
);
-- Failed code entries, for the five-per-fifteen-minutes limit.
create table public.casual_attendance_link_attempts(
 user_id uuid not null references auth.users(id),attempted_at timestamptz not null default clock_timestamp()
);
create index casual_attendance_link_attempts_user_idx on public.casual_attendance_link_attempts(user_id,attempted_at);

create table public.casual_attendance_settings(
 hotel_id uuid not null,department_id uuid not null,
 self_enabled boolean not null default false,
 confirmation text not null default 'on_fail' check(confirmation in ('off','on_fail','always')),
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id),
 primary key(hotel_id,department_id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);

-- What applied to each self check-in and check-out. Rows are append-only. record_id has no
-- foreign key because a supervisor may clear the day's record.
create table public.casual_attendance_self_events(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 person_id uuid not null references public.casual_attendance_people(id),record_id uuid not null,work_date date not null,
 action text not null check(action in ('check_in','check_out')),
 settings_version integer not null check(settings_version>=0),
 confirmation text not null check(confirmation in ('off','on_fail','always')),
 checks jsonb not null default '{}'::jsonb,
 result text not null check(result in ('verified','needs_review','unverified')),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id)
);
create index casual_attendance_self_events_record_idx on public.casual_attendance_self_events(record_id);
create trigger casual_attendance_self_events_append_only before update or delete on public.casual_attendance_self_events
 for each row execute function workstel_private.reject_casual_attendance_correction_change();

alter table public.casual_attendance_links enable row level security;
alter table public.casual_attendance_link_codes enable row level security;
alter table public.casual_attendance_link_attempts enable row level security;
alter table public.casual_attendance_settings enable row level security;
alter table public.casual_attendance_self_events enable row level security;
revoke all on public.casual_attendance_links,public.casual_attendance_link_codes,public.casual_attendance_link_attempts,
 public.casual_attendance_settings,public.casual_attendance_self_events from public,anon,authenticated;

create or replace function workstel_private.casual_attendance_record_json(r public.casual_attendance_records)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'person_id',r.person_id,'work_date',to_char(r.work_date,'YYYY-MM-DD'),'status',r.status,'shift',r.shift,
  'check_in',r.check_in,'check_out',r.check_out,'note',r.note,'corrected',r.corrected,'version',r.version,
  'source',r.source,'verification',r.verification,'review_note',r.review_note) $$;

-- The work date a self action belongs to: a night-shift person before 07:00 is on yesterday's shift.
create function workstel_private.casual_attendance_self_day(p_shift text)
returns date language sql stable set search_path='' as $$
 select case when p_shift='night' and (now() at time zone 'Asia/Jakarta')::time<time '07:00'
  then workstel_private.casual_attendance_today()-1 else workstel_private.casual_attendance_today() end $$;
-- The stricter of two verification values (rejected > needs_review > unverified > verified).
create function workstel_private.casual_attendance_worse(p_a text,p_b text)
returns text language sql immutable set search_path='' as $$
 select case when 'rejected' in (p_a,p_b) then 'rejected' when 'needs_review' in (p_a,p_b) then 'needs_review'
  when 'unverified' in (p_a,p_b) then 'unverified' else coalesce(p_a,p_b) end $$;
create function workstel_private.casual_attendance_module_on()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from workstel_private.installed_modules where module_id='casual-attendance' and enabled) $$;
-- The person actively linked to the caller, or no row.
create function workstel_private.casual_attendance_linked_person()
returns setof public.casual_attendance_people language sql stable security definer set search_path='' as $$
 select p.* from public.casual_attendance_links l join public.casual_attendance_people p on p.id=l.person_id
 where l.user_id=auth.uid() and l.unlinked_at is null $$;
revoke all on function workstel_private.casual_attendance_self_day(text) from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_worse(text,text) from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_module_on() from public,anon,authenticated;
revoke all on function workstel_private.casual_attendance_linked_person() from public,anon,authenticated;

-- People list gains whether each person is linked to an account.
create or replace function public.casual_attendance_list_people(p_hotel_id uuid,p_department_id uuid default null,p_type text default null,p_period text default 'current',p_search text default '',p_after uuid default null,p_limit integer default 50)
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
   to_char(p.start_date,'YYYY-MM-DD') as start_date,to_char(p.end_date,'YYYY-MM-DD') as end_date,p.shift,p.notes,p.status,p.version,p.updated_at,
   exists(select 1 from public.casual_attendance_links l where l.person_id=p.id and l.unlinked_at is null) as linked
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

-- Supervisor marks, plus approve and reject for self-made records.
create or replace function public.casual_attendance_mark(p_hotel_id uuid,p_person_id uuid,p_day date,p_action text,p_expected_version integer default null,p_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; rec public.casual_attendance_records; has_record boolean; today date:=workstel_private.casual_attendance_today();
begin
 select * into person from public.casual_attendance_people where id=p_person_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('casual-attendance',person.hotel_id,person.department_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,person.department_id,p_person_id,'casual-attendance.attendance.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_day is null or p_action is null or p_action not in ('check_in','check_out','leave','sick','absent','reopen','reset','approve','reject')
  or p_note is null or length(trim(p_note))>200 then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into rec from public.casual_attendance_records where person_id=p_person_id and work_date=p_day for update;
 has_record:=found;
 if (case when has_record then rec.version end) is distinct from p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 if p_action in ('approve','reject') then
  if not has_record or rec.verification is null
   or (p_action='approve' and rec.verification='verified') or (p_action='reject' and rec.verification in ('verified','rejected')) then
   return jsonb_build_object('error','NOT_REVIEWABLE');
  end if;
  update public.casual_attendance_records set verification=case when p_action='approve' then 'verified' else 'rejected' end,
   reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=trim(p_note),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=rec.id returning * into rec;
 elsif p_action in ('check_in','leave','sick','absent') then
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

-- Recap: rejected days are not present and add no worked time.
create or replace function public.casual_attendance_recap(p_hotel_id uuid,p_department_id uuid default null,p_type text default null,p_from date default null,p_to date default null,p_purpose text default 'view')
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
   (count(*) filter (where r.status='present' and r.verification is distinct from 'rejected'))::integer as present,
   (count(*) filter (where r.status='present' and r.verification is distinct from 'rejected' and workstel_private.casual_attendance_is_late(r.work_date,r.shift,r.check_in)))::integer as late,
   (count(*) filter (where r.status='leave'))::integer as leave,
   (count(*) filter (where r.status='sick'))::integer as sick,
   (count(*) filter (where r.status='absent'))::integer as absent,
   (count(*) filter (where r.verification in ('needs_review','unverified')))::integer as needs_review,
   (count(*) filter (where r.verification='rejected'))::integer as rejected,
   coalesce(sum(floor(extract(epoch from r.check_out-r.check_in)/60)) filter (where r.check_out is not null and r.verification is distinct from 'rejected'),0)::integer as minutes
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

-- Manager: create a one-time link code (action 'code') or end the person's link ('unlink').
create function public.casual_attendance_person_link(p_hotel_id uuid,p_person_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; alphabet text:='ABCDEFGHJKMNPQRSTUVWXYZ23456789'; code text; raw bytea; expires timestamptz;
 audit_action text:='casual-attendance.person.'||case when p_action='unlink' then 'unlink' else 'link-code' end;
begin
 select * into person from public.casual_attendance_people where id=p_person_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('casual-attendance',person.hotel_id,person.department_id,'manage') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,person.department_id,p_person_id,audit_action,'denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('code','unlink') then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_action='unlink' then
  update public.casual_attendance_links set unlinked_at=clock_timestamp(),unlinked_by=auth.uid() where person_id=person.id and unlinked_at is null;
  if not found then return jsonb_build_object('error','NOT_LINKED');end if;
  delete from public.casual_attendance_link_codes where person_id=person.id;
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,person.id,audit_action,'success');
  return jsonb_build_object('data',null);
 end if;
 if person.status<>'active' then return jsonb_build_object('error','INVALID_INPUT');end if;
 if exists(select 1 from public.casual_attendance_links where person_id=person.id and unlinked_at is null) then return jsonb_build_object('error','ALREADY_LINKED');end if;
 expires:=clock_timestamp()+interval '24 hours';
 loop
  -- Six characters from a 31-letter alphabet without 0/O and 1/I/L, from random UUID bytes.
  raw:=uuid_send(gen_random_uuid()); code:='';
  for i in 0..5 loop code:=code||substr(alphabet,1+get_byte(raw,i)%31,1);end loop;
  begin
   insert into public.casual_attendance_link_codes(person_id,code_hash,expires_at,created_by)
   values(person.id,sha256(convert_to(code,'UTF8')),expires,auth.uid())
   on conflict(person_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=clock_timestamp(),created_by=excluded.created_by;
   exit;
  exception when unique_violation then null;
  end;
 end loop;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,person.id,audit_action,'success');
 return jsonb_build_object('data',jsonb_build_object('code',code,'expires_at',expires));
end$$;

-- What the signed-in account sees on My attendance. linked=false means it may enter a code.
create function public.casual_attendance_self_status()
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; settings public.casual_attendance_settings; rec public.casual_attendance_records;
 work_day date; dept_name text; history jsonb;
begin
 if auth.uid() is null or not workstel_private.casual_attendance_module_on() then return jsonb_build_object('error','ACCESS_DENIED');end if;
 select * into person from workstel_private.casual_attendance_linked_person();
 if not found then return jsonb_build_object('data',jsonb_build_object('linked',false));end if;
 select name into dept_name from public.workstel_departments where hotel_id=person.hotel_id and id=person.department_id;
 select * into settings from public.casual_attendance_settings where hotel_id=person.hotel_id and department_id=person.department_id;
 work_day:=workstel_private.casual_attendance_self_day(person.shift);
 -- An open record from yesterday (a night shift running late) is still today's business.
 select * into rec from public.casual_attendance_records r where r.person_id=person.id and r.status='present' and r.check_out is null
  and r.work_date in (workstel_private.casual_attendance_today(),workstel_private.casual_attendance_today()-1) order by r.work_date desc limit 1;
 if found then work_day:=rec.work_date;
 else select * into rec from public.casual_attendance_records r where r.person_id=person.id and r.work_date=work_day; end if;
 select coalesce(jsonb_agg(workstel_private.casual_attendance_record_json(r) order by r.work_date desc),'[]'::jsonb) into history
 from public.casual_attendance_records r where r.person_id=person.id and r.work_date between workstel_private.casual_attendance_today()-13 and workstel_private.casual_attendance_today();
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,person.id,'casual-attendance.attendance.self-read','success');
 return jsonb_build_object('data',jsonb_build_object('linked',true,
  'person',jsonb_build_object('id',person.id,'hotel_id',person.hotel_id,'name',person.name,'department_name',coalesce(dept_name,''),'shift',person.shift,'active',person.status='active'),
  'work_date',to_char(work_day,'YYYY-MM-DD'),
  'scheduled',workstel_private.casual_attendance_scheduled(person,work_day),
  'self_enabled',coalesce(settings.self_enabled,false),
  'record',case when rec.id is null then null else workstel_private.casual_attendance_record_json(rec) end,
  'history',history));
end$$;

-- A signed-in account enters a manager's code and becomes linked to that person.
create function public.casual_attendance_redeem_link_code(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry public.casual_attendance_link_codes; person public.casual_attendance_people; normalized text:=upper(regexp_replace(coalesce(p_code,''),'[\s-]','','g'));
begin
 if auth.uid() is null or not workstel_private.casual_attendance_module_on() then return jsonb_build_object('error','ACCESS_DENIED');end if;
 if (select count(*) from public.casual_attendance_link_attempts where user_id=auth.uid() and attempted_at>clock_timestamp()-interval '15 minutes')>=5 then
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'casual-attendance.person.link','denied');
  return jsonb_build_object('error','TOO_MANY_ATTEMPTS');
 end if;
 if exists(select 1 from public.casual_attendance_links where user_id=auth.uid() and unlinked_at is null) then return jsonb_build_object('error','ALREADY_LINKED');end if;
 if normalized ~ '^[A-HJKMNP-Z2-9]{6}$' then
  select * into entry from public.casual_attendance_link_codes where code_hash=sha256(convert_to(normalized,'UTF8')) and expires_at>clock_timestamp() for update;
  if found then select * into person from public.casual_attendance_people where id=entry.person_id and status='active'; end if;
 end if;
 -- Wrong, expired and unknown codes look the same to the caller.
 if person.id is null then
  insert into public.casual_attendance_link_attempts(user_id) values(auth.uid());
  insert into workstel_private.audit_events(actor_id,action,outcome) values(auth.uid(),'casual-attendance.person.link','denied');
  return jsonb_build_object('error','CODE_INVALID');
 end if;
 begin
  insert into public.casual_attendance_links(person_id,user_id,created_by) values(person.id,auth.uid(),entry.created_by);
 exception when unique_violation then
  return jsonb_build_object('error','ALREADY_LINKED');
 end;
 delete from public.casual_attendance_link_codes where person_id=person.id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,person.id,'casual-attendance.person.link','success');
 return public.casual_attendance_self_status();
end$$;

-- The linked account checks its own person in or out with the server clock. Location arrives
-- in phase 2; until then no automatic check exists, so checks count as passed.
create function public.casual_attendance_self_mark(p_action text,p_location jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.casual_attendance_people; settings public.casual_attendance_settings; rec public.casual_attendance_records;
 work_day date; outcome text; confirmation text; audit_action text:='casual-attendance.attendance.self-'||replace(coalesce(p_action,'mark'),'_','-');
begin
 if p_action is null or p_action not in ('check_in','check_out') or p_location is not null then return jsonb_build_object('error','INVALID_INPUT');end if;
 if auth.uid() is not null and workstel_private.casual_attendance_module_on() then
  select * into person from workstel_private.casual_attendance_linked_person();
 end if;
 if person.id is null or person.status<>'active' then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,person.id,audit_action,'denied');
  return jsonb_build_object('error','NOT_LINKED');
 end if;
 select * into settings from public.casual_attendance_settings where hotel_id=person.hotel_id and department_id=person.department_id;
 if not coalesce(settings.self_enabled,false) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,person.id,audit_action,'denied');
  return jsonb_build_object('error','SELF_DISABLED');
 end if;
 confirmation:=settings.confirmation;
 outcome:=case when confirmation='always' then 'needs_review' else 'verified' end;
 if p_action='check_in' then
  work_day:=workstel_private.casual_attendance_self_day(person.shift);
  if exists(select 1 from public.casual_attendance_records r where r.person_id=person.id and r.work_date=work_day) then return jsonb_build_object('error','ALREADY_MARKED');end if;
  if not workstel_private.casual_attendance_scheduled(person,work_day) then return jsonb_build_object('error','NOT_SCHEDULED');end if;
  begin
   insert into public.casual_attendance_records(hotel_id,department_id,person_id,work_date,status,shift,check_in,source,verification,created_by,updated_by)
   values(person.hotel_id,person.department_id,person.id,work_day,'present',person.shift,clock_timestamp(),'self',outcome,auth.uid(),auth.uid())
   returning * into rec;
  exception when unique_violation then
   return jsonb_build_object('error','ALREADY_MARKED');
  end;
 else
  select * into rec from public.casual_attendance_records r where r.person_id=person.id and r.status='present' and r.check_out is null
   and r.work_date in (workstel_private.casual_attendance_today(),workstel_private.casual_attendance_today()-1) order by r.work_date desc limit 1 for update;
  if not found then return jsonb_build_object('error','NOT_CHECKED_IN');end if;
  update public.casual_attendance_records set check_out=greatest(clock_timestamp(),rec.check_in+interval '1 second'),
   verification=workstel_private.casual_attendance_worse(rec.verification,outcome),version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=rec.id returning * into rec;
 end if;
 insert into public.casual_attendance_self_events(hotel_id,department_id,person_id,record_id,work_date,action,settings_version,confirmation,result,created_by)
 values(person.hotel_id,person.department_id,person.id,rec.id,rec.work_date,p_action,coalesce(settings.version,0),confirmation,outcome,auth.uid());
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,rec.id,audit_action,'success');
 return jsonb_build_object('data',workstel_private.casual_attendance_record_json(rec));
end$$;

-- Self check-in settings for each readable department; departments without a row use the defaults.
create function public.casual_attendance_settings(p_hotel_id uuid,p_department_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('casual-attendance',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.settings.read','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('department_id',d.id,'department_name',d.name,'self_enabled',coalesce(s.self_enabled,false),
  'confirmation',coalesce(s.confirmation,'on_fail'),'version',coalesce(s.version,0)) order by lower(d.name),d.id),'[]'::jsonb) into result
 from public.workstel_departments d left join public.casual_attendance_settings s on s.hotel_id=d.hotel_id and s.department_id=d.id
 where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('casual-attendance',p_hotel_id,d.id,'read');
 return jsonb_build_object('data',result);
end$$;

create function public.casual_attendance_save_settings(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_expected_version integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.casual_attendance_settings; current_version integer;
begin
 if not workstel_private.module_allowed('casual-attendance',p_hotel_id,p_department_id,'manage') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.settings.save','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('selfEnabled','confirmation'))
  or jsonb_typeof(p_input->'selfEnabled') is distinct from 'boolean'
  or jsonb_typeof(p_input->'confirmation') is distinct from 'string' or p_input->>'confirmation' not in ('off','on_fail','always')
  or p_expected_version is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select version into current_version from public.casual_attendance_settings where hotel_id=p_hotel_id and department_id=p_department_id for update;
 if coalesce(current_version,0)<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 begin
  insert into public.casual_attendance_settings as s(hotel_id,department_id,self_enabled,confirmation,updated_by)
  values(p_hotel_id,p_department_id,(p_input->>'selfEnabled')::boolean,p_input->>'confirmation',auth.uid())
  on conflict(hotel_id,department_id) do update set self_enabled=excluded.self_enabled,confirmation=excluded.confirmation,
   version=s.version+1,updated_at=clock_timestamp(),updated_by=excluded.updated_by
  returning * into saved;
 exception when unique_violation then
  return jsonb_build_object('error','VERSION_CONFLICT');
 end;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'casual-attendance.settings.save','success');
 return jsonb_build_object('data',jsonb_build_object('version',saved.version));
end$$;

revoke all on function public.casual_attendance_person_link(uuid,uuid,text) from public,anon;
revoke all on function public.casual_attendance_self_status() from public,anon;
revoke all on function public.casual_attendance_redeem_link_code(text) from public,anon;
revoke all on function public.casual_attendance_self_mark(text,jsonb) from public,anon;
revoke all on function public.casual_attendance_settings(uuid,uuid) from public,anon;
revoke all on function public.casual_attendance_save_settings(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.casual_attendance_person_link(uuid,uuid,text) to authenticated;
grant execute on function public.casual_attendance_self_status() to authenticated;
grant execute on function public.casual_attendance_redeem_link_code(text) to authenticated;
grant execute on function public.casual_attendance_self_mark(text,jsonb) to authenticated;
grant execute on function public.casual_attendance_settings(uuid,uuid) to authenticated;
grant execute on function public.casual_attendance_save_settings(uuid,uuid,jsonb,integer) to authenticated;

update workstel_private.installed_modules set schema_version=2 where module_id='casual-attendance';
insert into workstel_private.schema_migrations(version) values ('202611100002') on conflict do nothing;
notify pgrst,'reload schema';
commit;
