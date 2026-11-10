begin;
-- Casual Attendance: undoing a check-out ends the review of that day. Approve and reject judge
-- a closed day, so reopening clears verification and the review fields; the next check-out
-- starts a new review. A self check-out takes the original check-in's result as its base.

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
  -- The review belonged to the closed day; the next check-out starts a new one.
  update public.casual_attendance_records set check_out=null,verification=null,reviewed_by=null,reviewed_at=null,review_note='',
   version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
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

-- The linked account checks its own person in or out with the server clock. Location arrives
-- in phase 2; until then no automatic check exists, so checks count as passed.
create or replace function public.casual_attendance_self_mark(p_action text,p_location jsonb default null)
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
  -- After a supervisor undid the check-out the record has no verification; the self check-in's
  -- own result is the base again, so a failed check-in is not forgotten.
  if rec.verification is null then
   select e.result into rec.verification from public.casual_attendance_self_events e
   where e.record_id=rec.id and e.action='check_in' order by e.created_at desc limit 1;
  end if;
  update public.casual_attendance_records set check_out=greatest(clock_timestamp(),rec.check_in+interval '1 second'),
   verification=workstel_private.casual_attendance_worse(rec.verification,outcome),reviewed_by=null,reviewed_at=null,review_note='',
   version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=rec.id returning * into rec;
 end if;
 insert into public.casual_attendance_self_events(hotel_id,department_id,person_id,record_id,work_date,action,settings_version,confirmation,result,created_by)
 values(person.hotel_id,person.department_id,person.id,rec.id,rec.work_date,p_action,coalesce(settings.version,0),confirmation,outcome,auth.uid());
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),person.hotel_id,person.department_id,rec.id,audit_action,'success');
 return jsonb_build_object('data',workstel_private.casual_attendance_record_json(rec));
end$$;

update workstel_private.installed_modules set schema_version=3 where module_id='casual-attendance';
insert into workstel_private.schema_migrations(version) values ('202611100003') on conflict do nothing;
notify pgrst,'reload schema';
commit;
