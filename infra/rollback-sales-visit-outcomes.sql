-- Rolls back migration 202611090004_sales_visit_outcomes.sql.
-- Deploy a frontend without visit outcomes first: this one sends outcome fields the restored
-- log function refuses. The outcome, met-with and reference values of every activity that has
-- one are copied to workstel_private.sales_activity_outcomes_backup before the columns are
-- dropped; drop that table once it is no longer needed. Activities themselves are untouched.
begin;
create table workstel_private.sales_activity_outcomes_backup as
 select id as activity_id,outcome,met_with,reference,clock_timestamp() as backed_up_at
 from public.sales_activities where outcome is not null or met_with<>'' or reference<>'';
alter table workstel_private.sales_activity_outcomes_backup enable row level security;
revoke all on workstel_private.sales_activity_outcomes_backup from public,anon,authenticated;

-- The functions as they were before 202611090004.
create or replace function public.sales_activity_log(p_hotel_id uuid,p_account_id uuid,p_deal_id uuid,p_input jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.sales_accounts; deal public.sales_deals; activity public.sales_activities; happened date; follow_up date;
begin
 select * into account from public.sales_accounts where id=p_account_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('sales-crm',account.hotel_id,account.department_id,'write') then
  return workstel_private.sales_denied(p_hotel_id,account.department_id,p_account_id,'sales-crm.write');
 end if;
 if p_idempotency_key is null or p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('type','occurredOn','summary','nextFollowUp'))
  or not (p_input ? 'type' and p_input ? 'occurredOn' and p_input ? 'summary')
  or jsonb_typeof(p_input->'type')<>'string' or jsonb_typeof(p_input->'summary')<>'string'
  or p_input->>'type' not in ('call','email','visit','meeting','site-inspection','note')
  or length(trim(p_input->>'summary')) not between 1 and 1000 then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into activity from public.sales_activities where created_by=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if activity.account_id<>p_account_id then return jsonb_build_object('error','INVALID_INPUT');end if;
  return jsonb_build_object('data',jsonb_build_object('id',activity.id,'replayed',true));
 end if;
 if account.status<>'active' then return jsonb_build_object('error','ACCOUNT_ARCHIVED');end if;
 happened:=workstel_private.sales_date(p_input->'occurredOn');
 follow_up:=workstel_private.sales_date(p_input->'nextFollowUp');
 if happened is null or happened=date '0001-01-01' or happened>workstel_private.sales_today() or follow_up=date '0001-01-01'
  or (follow_up is not null and p_deal_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_deal_id is not null then
  select * into deal from public.sales_deals where id=p_deal_id and account_id=p_account_id for update;
  if not found then return jsonb_build_object('error','INVALID_INPUT');end if;
  if follow_up is not null then
   if deal.stage not in ('lead','proposal','negotiation') then return jsonb_build_object('error','DEAL_CLOSED');end if;
   update public.sales_deals set next_follow_up=follow_up,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid() where id=deal.id;
  end if;
 end if;
 insert into public.sales_activities(hotel_id,department_id,account_id,deal_id,activity_type,occurred_on,summary,created_by,idempotency_key)
 values(p_hotel_id,account.department_id,account.id,p_deal_id,p_input->>'type',happened,trim(p_input->>'summary'),auth.uid(),p_idempotency_key) returning * into activity;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,activity.id,'sales-crm.activity.log','success');
 return jsonb_build_object('data',jsonb_build_object('id',activity.id,'replayed',false));
end$$;

create or replace function public.sales_activities_list(p_hotel_id uuid,p_account_id uuid,p_deal_id uuid default null,p_after uuid default null,p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; account public.sales_accounts; cursor_row public.sales_activities;
begin
 select * into account from public.sales_accounts where id=p_account_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('sales-crm',account.hotel_id,account.department_id,'read') then
  return workstel_private.sales_denied(p_hotel_id,account.department_id,p_account_id,'sales-crm.activities.list');
 end if;
 if p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select * into cursor_row from public.sales_activities where id=p_after and account_id=p_account_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.occurred_on desc,row_data.created_at desc,row_data.id desc),'[]'::jsonb) into result from (
  select x.id,x.account_id,x.deal_id,s.title as deal_title,x.activity_type,x.occurred_on,x.summary,x.created_at,coalesce(u.email,'') as created_by_email,
   workstel_private.staff_display_name(x.created_by) as created_by_name,
   (x.created_at at time zone 'Asia/Jakarta')::date as recorded_on,
   workstel_private.sales_entry_delay(x.occurred_on,x.created_at) as entry_delay_days,
   workstel_private.sales_entry_timing(workstel_private.sales_entry_delay(x.occurred_on,x.created_at)) as entry_timing
  from public.sales_activities x left join public.sales_deals s on s.id=x.deal_id left join auth.users u on u.id=x.created_by
  where x.account_id=p_account_id and (p_deal_id is null or x.deal_id=p_deal_id)
  and (cursor_row.id is null or (x.occurred_on,x.created_at,x.id)<(cursor_row.occurred_on,cursor_row.created_at,cursor_row.id))
  order by x.occurred_on desc,x.created_at desc,x.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'sales-crm.activities.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

create or replace function public.sales_entry_report(p_hotel_id uuid,p_department_id uuid default null,p_month date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 month_start date:=date_trunc('month',coalesce(p_month,workstel_private.sales_today()))::date;
 range_start timestamptz; range_end timestamptz;
 departments uuid[]; totals jsonb; people jsonb; entries jsonb; late_count integer;
begin
 select coalesce(array_agg(d.id),'{}') into departments from public.workstel_departments d
 where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id)
 and workstel_private.module_allowed('sales-crm',p_hotel_id,d.id,'manage');
 -- One department asked for and not managed, or no managed department at all.
 if cardinality(departments)=0 then
  return workstel_private.sales_denied(p_hotel_id,p_department_id,null,'sales-crm.entry-report');
 end if;
 if month_start<date '2000-01-01' or month_start>workstel_private.sales_today() then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 range_start:=month_start::timestamp at time zone 'Asia/Jakarta';
 range_end:=(month_start+interval '1 month')::timestamp at time zone 'Asia/Jakarta';
 with entry_rows as (
  select x.id,x.account_id,a.name as account_name,x.activity_type,x.occurred_on,x.created_at,x.created_by,
   (x.created_at at time zone 'Asia/Jakarta')::date as recorded_on,
   workstel_private.sales_entry_delay(x.occurred_on,x.created_at) as delay,
   workstel_private.sales_entry_timing(workstel_private.sales_entry_delay(x.occurred_on,x.created_at)) as timing,
   coalesce(u.email,'') as email,workstel_private.staff_display_name(x.created_by) as name
  from public.sales_activities x join public.sales_accounts a on a.id=x.account_id
  left join auth.users u on u.id=x.created_by
  where x.hotel_id=p_hotel_id and x.department_id=any(departments)
  and x.created_at>=range_start and x.created_at<range_end)
 select
  (select jsonb_build_object('total',count(*),'on_time',count(*) filter(where timing='on-time'),
    'late',count(*) filter(where timing='late'),'backdated',count(*) filter(where timing='backdated')) from entry_rows),
  -- People needing attention first: most backdated, then most late.
  (select coalesce(jsonb_agg(jsonb_build_object('email',p.email,'name',p.name,'total',p.total,'on_time',p.on_time,
    'late',p.late,'backdated',p.backdated) order by p.backdated desc,p.late desc,lower(p.name),p.email),'[]'::jsonb) from (
    select r.created_by,min(r.email) as email,min(r.name) as name,count(*) as total,
     count(*) filter(where r.timing='on-time') as on_time,count(*) filter(where r.timing='late') as late,
     count(*) filter(where r.timing='backdated') as backdated
    from entry_rows r group by r.created_by) p),
  -- Up to 100 entries, entered latest first: largest delay, then most recent.
  (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'account_id',e.account_id,'account_name',e.account_name,
    'activity_type',e.activity_type,'occurred_on',e.occurred_on,'recorded_on',e.recorded_on,'created_at',e.created_at,
    'entry_delay_days',e.delay,'entry_timing',e.timing,'created_by_email',e.email,'created_by_name',e.name)
    order by e.delay desc,e.created_at desc,e.id),'[]'::jsonb) from (
    select * from entry_rows r where r.timing<>'on-time' order by r.delay desc,r.created_at desc,r.id limit 100) e),
  (select count(*) from entry_rows where timing<>'on-time')
 into totals,people,entries,late_count;

 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome)
 values(auth.uid(),p_hotel_id,p_department_id,null,'sales-crm.entry-report','success');
 return jsonb_build_object('data',jsonb_build_object('totals',totals,'people',people,'entries',entries),
  'meta',jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'entriesTotal',late_count));
end$$;

alter table public.sales_activities drop column outcome,drop column met_with,drop column reference;
update workstel_private.installed_modules set schema_version=3 where module_id='sales-crm';
delete from workstel_private.schema_migrations where version='202611090004';
notify pgrst,'reload schema';
commit;
