begin;
-- Sales CRM activity entry timing. occurred_on is typed by the user and may lie in the past;
-- created_at is the server clock at insert and cannot be set by the client (the log RPC
-- never accepts it and activities are append-only). The gap between the two, counted in
-- hotel calendar days, tells whether an activity was logged on time or entered afterwards.
--   0 days    on-time
--   1-2 days  late
--   3+ days   backdated
-- The thresholds are fixed for every hotel until a per-hotel setting is designed.
create function workstel_private.sales_entry_delay(p_occurred_on date,p_created_at timestamptz)
returns integer language sql immutable set search_path='' as $$
 select greatest((p_created_at at time zone 'Asia/Jakarta')::date-p_occurred_on,0) $$;
create function workstel_private.sales_entry_timing(p_delay integer)
returns text language sql immutable set search_path='' as $$
 select case when p_delay<=0 then 'on-time' when p_delay<=2 then 'late' else 'backdated' end $$;
revoke all on function workstel_private.sales_entry_delay(date,timestamptz),workstel_private.sales_entry_timing(integer) from public,anon,authenticated;

-- Same rows as before, plus recorded_on, entry_delay_days and entry_timing.
-- Existing grants survive create or replace.
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

update workstel_private.installed_modules set schema_version=2 where module_id='sales-crm';
insert into workstel_private.schema_migrations(version) values ('202611090001') on conflict do nothing;
notify pgrst,'reload schema';
commit;
