begin;
-- Sales CRM entry report: for one hotel month, how many activities each person logged on time,
-- late (1-2 days after) or backdated (3+ days after), plus the late and backdated entries.
-- The month is the hotel month in which the server recorded the activity (created_at), so a
-- report does not change when someone later backdates into it.
--
-- Managers only: every department in scope needs the sales-crm manage level. Names come from
-- workstel_private.staff_display_name under the Sales CRM contract in MODULE_STANDARD.md
-- (display name only, or the part of the email before @).
--
-- Additive only: one new function and no table changes. Roll back with
-- infra/rollback-sales-entry-report.sql.
create function public.sales_entry_report(p_hotel_id uuid,p_department_id uuid default null,p_month date default null)
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
revoke all on function public.sales_entry_report(uuid,uuid,date) from public,anon;
grant execute on function public.sales_entry_report(uuid,uuid,date) to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611090003') on conflict do nothing;
notify pgrst,'reload schema';
commit;
