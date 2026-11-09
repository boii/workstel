begin;
-- Staff names, approved by the user on 9 November 2026 and recorded in MODULE_STANDARD.md
-- (Module isolation).
--
-- 1. Sales CRM shows who logged an activity by the profile display name. Only the display
--    name leaves the profile (through workstel_private.staff_display_name from 202611070001,
--    which falls back to the part of the email before @), only inside Sales CRM activity rows
--    the caller may already read, and those rows have always carried the logger's email.
--
-- 2. A new account starts with a display name: the Google name for a Google sign-up, or the
--    name a developer typed in Add user (sent by the workstel-users function as
--    user_metadata.full_name). Only accounts created after this migration are named; existing
--    profiles are not touched. Staff can still change the name in Settings -> Profile.

-- A name from sign-up metadata, cleaned like workstel_profile_save cleans displayName.
-- Returns null when there is nothing usable, so a bad name never blocks sign-up.
create function workstel_private.signup_display_name(p_meta jsonb)
returns text language sql immutable set search_path='' as $$
 select case when clean is null or clean ~ '[[:cntrl:]]' then null else left(clean,80) end
 from (select nullif(btrim(regexp_replace(coalesce(
  case when jsonb_typeof(p_meta->'full_name')='string' then p_meta->>'full_name' end,
  case when jsonb_typeof(p_meta->'name')='string' then p_meta->>'name' end,''),'\s+',' ','g')),'') as clean) x $$;
revoke all on function workstel_private.signup_display_name(jsonb) from public,anon,authenticated;

-- Names only the accounts the sign-up hook admits: Google sign-ups and developer-created ones.
-- Any failure is swallowed: the account is still created, just without a name.
create function workstel_private.name_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare clean text;
begin
 if new.raw_app_meta_data->>'provider'='google' or new.raw_app_meta_data->'workstel_admin_created'='true'::jsonb then
  clean:=workstel_private.signup_display_name(new.raw_user_meta_data);
  if clean is not null then
   insert into workstel_private.user_profiles(user_id,display_name) values(new.id,clean)
   on conflict(user_id) do nothing;
  end if;
 end if;
 return new;
exception when others then
 return new;
end$$;
revoke all on function workstel_private.name_new_user() from public,anon,authenticated;
create trigger workstel_name_new_user after insert on auth.users
 for each row execute function workstel_private.name_new_user();

-- Same rows as 202611090001, plus created_by_name. Existing grants survive create or replace.
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

update workstel_private.installed_modules set schema_version=3 where module_id='sales-crm';
insert into workstel_private.schema_migrations(version) values ('202611090002') on conflict do nothing;
notify pgrst,'reload schema';
commit;
