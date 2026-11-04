begin;
-- Sales CRM: accounts (companies, agents and other buyers) with one main contact, a deal
-- pipeline per account and an append-only activity log, scoped per hotel department.
alter table workstel_private.installed_modules drop constraint installed_modules_module_id_check;
alter table workstel_private.installed_modules add constraint installed_modules_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm'));
alter table workstel_private.module_access drop constraint module_access_module_id_check;
alter table workstel_private.module_access add constraint module_access_module_id_check
 check(module_id in ('vehicle','bin-card','documents','sales-crm'));

create table public.sales_accounts(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 150),
 account_type text not null check(account_type in ('corporate','travel-agent','government','mice','wedding','other')),
 contact_name text not null default '' check(length(contact_name)<=100),
 contact_phone text not null default '' check(contact_phone='' or contact_phone ~ '^[0-9+() .-]{4,40}$'),
 contact_email text not null default '' check(contact_email='' or (length(contact_email)<=254 and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
 notes text not null default '' check(length(notes)<=1000),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 unique(hotel_id,department_id,id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index sales_accounts_scope_idx on public.sales_accounts(hotel_id,department_id,status,lower(name),id);

-- A deal keeps its account's department, so department scope never needs a join.
create table public.sales_deals(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,account_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 150),
 segment text not null check(segment in ('corporate','group','mice','wedding','long-stay','other')),
 stage text not null default 'lead' check(stage in ('lead','proposal','negotiation','won','lost')),
 value_amount bigint not null default 0 check(value_amount between 0 and 1000000000000),
 room_nights integer check(room_nights between 1 and 100000),
 arrival_date date,departure_date date,next_follow_up date,
 lost_reason text not null default '' check(length(lost_reason)<=300),
 notes text not null default '' check(length(notes)<=1000),
 closed_at timestamptz,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 check(departure_date is null or (arrival_date is not null and departure_date>=arrival_date)),
 check((stage in ('won','lost'))=(closed_at is not null)),
 check(stage<>'lost' or length(trim(lost_reason))>0),
 unique(hotel_id,account_id,id),
 foreign key(hotel_id,department_id,account_id) references public.sales_accounts(hotel_id,department_id,id)
);
create index sales_deals_scope_idx on public.sales_deals(hotel_id,department_id,stage,next_follow_up,id);
create index sales_deals_account_idx on public.sales_deals(account_id,stage);

create table public.sales_activities(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 account_id uuid not null,deal_id uuid,
 activity_type text not null check(activity_type in ('call','email','visit','meeting','site-inspection','note')),
 occurred_on date not null,
 summary text not null check(length(trim(summary)) between 1 and 1000),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 idempotency_key uuid not null,unique(created_by,idempotency_key),
 foreign key(hotel_id,department_id,account_id) references public.sales_accounts(hotel_id,department_id,id),
 foreign key(hotel_id,account_id,deal_id) references public.sales_deals(hotel_id,account_id,id)
);
create index sales_activities_account_idx on public.sales_activities(account_id,occurred_on desc,created_at desc,id desc);
alter table public.sales_accounts enable row level security;
alter table public.sales_deals enable row level security;
alter table public.sales_activities enable row level security;
revoke all on public.sales_accounts,public.sales_deals,public.sales_activities from public,anon,authenticated;

create function workstel_private.reject_sales_activity_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'Sales activities are append-only';end$$;
create trigger sales_activities_append_only before update or delete on public.sales_activities
 for each row execute function workstel_private.reject_sales_activity_change();

-- Follow-up dates are calendar days at the hotel; Workstel hotels run on Western Indonesia Time.
create function workstel_private.sales_today()
returns date language sql stable set search_path='' as $$select (now() at time zone 'Asia/Jakarta')::date$$;
-- Parses an optional ISO date from a JSON value: SQL null for JSON null or absent,
-- and the sentinel 0001-01-01 for anything malformed so callers can reject it.
create function workstel_private.sales_date(p_value jsonb)
returns date language plpgsql immutable set search_path='' as $$
declare parsed date;
begin
 if p_value is null or jsonb_typeof(p_value)='null' then return null;end if;
 if jsonb_typeof(p_value)<>'string' or (p_value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' then return date '0001-01-01';end if;
 parsed:=(p_value#>>'{}')::date;
 if parsed<date '2000-01-01' or parsed>date '2100-12-31' then return date '0001-01-01';end if;
 return parsed;
exception when others then return date '0001-01-01';
end$$;
revoke all on function workstel_private.reject_sales_activity_change(),workstel_private.sales_today(),workstel_private.sales_date(jsonb) from public,anon,authenticated;

create function workstel_private.sales_denied(p_hotel uuid,p_department uuid,p_resource uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel,p_department,p_resource,p_action,'denied');
 return jsonb_build_object('error','ACCESS_DENIED');
end$$;
revoke all on function workstel_private.sales_denied(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Pipeline figures for the departments the caller can read (optionally one department).
create function public.sales_summary(p_hotel_id uuid,p_department_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; today date:=workstel_private.sales_today();
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('sales-crm',p_hotel_id,d.id,'read')) then
  return workstel_private.sales_denied(p_hotel_id,p_department_id,null,'sales-crm.summary');
 end if;
 select jsonb_build_object(
  'open_count',count(*) filter(where s.stage in ('lead','proposal','negotiation')),
  'open_value',coalesce(sum(s.value_amount) filter(where s.stage in ('lead','proposal','negotiation')),0),
  'overdue',count(*) filter(where s.stage in ('lead','proposal','negotiation') and s.next_follow_up<today),
  'due_week',count(*) filter(where s.stage in ('lead','proposal','negotiation') and s.next_follow_up between today and today+6),
  'won_month_count',count(*) filter(where s.stage='won' and (s.closed_at at time zone 'Asia/Jakarta')::date>=date_trunc('month',today)::date),
  'won_month_value',coalesce(sum(s.value_amount) filter(where s.stage='won' and (s.closed_at at time zone 'Asia/Jakarta')::date>=date_trunc('month',today)::date),0),
  'stages',jsonb_build_object(
   'lead',jsonb_build_object('count',count(*) filter(where s.stage='lead'),'value',coalesce(sum(s.value_amount) filter(where s.stage='lead'),0)),
   'proposal',jsonb_build_object('count',count(*) filter(where s.stage='proposal'),'value',coalesce(sum(s.value_amount) filter(where s.stage='proposal'),0)),
   'negotiation',jsonb_build_object('count',count(*) filter(where s.stage='negotiation'),'value',coalesce(sum(s.value_amount) filter(where s.stage='negotiation'),0))))
 into result
 from public.sales_deals s join public.sales_accounts a on a.id=s.account_id and a.status='active'
 where s.hotel_id=p_hotel_id and (p_department_id is null or s.department_id=p_department_id)
 and workstel_private.module_allowed('sales-crm',s.hotel_id,s.department_id,'read');
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'sales-crm.summary','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('today',today));
end$$;

create function public.sales_accounts_list(p_hotel_id uuid,p_department_id uuid default null,p_status text default 'active',p_type text default null,p_search text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; after_name text;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('sales-crm',p_hotel_id,d.id,'read')) then
  return workstel_private.sales_denied(p_hotel_id,p_department_id,null,'sales-crm.accounts.list');
 end if;
 if p_status is null or p_status not in ('active','archived','all') or (p_type is not null and p_type not in ('corporate','travel-agent','government','mice','wedding','other'))
  or p_limit is null or p_limit<1 or p_limit>100 or p_search is null or length(p_search)>150 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select lower(name) into after_name from public.sales_accounts where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by lower(row_data.name),row_data.id),'[]'::jsonb) into result from (
  select a.id,a.hotel_id,a.department_id,d.name as department_name,a.name,a.account_type,a.contact_name,a.contact_phone,a.contact_email,a.notes,a.status,a.version,a.updated_at,
   coalesce(o.open_deals,0) as open_deals,coalesce(o.open_value,0) as open_value,o.next_follow_up,
   (select max(x.occurred_on) from public.sales_activities x where x.account_id=a.id) as last_activity_on
  from public.sales_accounts a join public.workstel_departments d on d.hotel_id=a.hotel_id and d.id=a.department_id
  left join lateral (select count(*) as open_deals,sum(s.value_amount) as open_value,min(s.next_follow_up) as next_follow_up
   from public.sales_deals s where s.account_id=a.id and s.stage in ('lead','proposal','negotiation')) o on true
  where a.hotel_id=p_hotel_id and workstel_private.module_allowed('sales-crm',a.hotel_id,a.department_id,'read')
  and (p_department_id is null or a.department_id=p_department_id)
  and (p_status='all' or a.status=p_status)
  and (p_type is null or a.account_type=p_type)
  and (p_search='' or position(lower(p_search) in lower(a.name||' '||a.contact_name||' '||a.contact_email))>0)
  and (after_name is null or (lower(a.name),a.id)>(after_name,p_after))
  order by lower(a.name),a.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'sales-crm.accounts.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

-- write adds and edits accounts; manage also archives and restores them. The department is
-- fixed at creation because deals and activities inherit it.
create function public.sales_account_save(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_account_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare account public.sales_accounts; existing public.sales_accounts; permission text; email text; phone text;
begin
 permission:=case when p_action in ('archive','restore') then 'manage' else 'write' end;
 if not workstel_private.module_allowed('sales-crm',p_hotel_id,p_department_id,permission) then
  return workstel_private.sales_denied(p_hotel_id,p_department_id,p_account_id,'sales-crm.write');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_account_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_account_id is not null then
  select * into existing from public.sales_accounts where id=p_account_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.module_allowed('sales-crm',existing.hotel_id,existing.department_id,permission) then
   return workstel_private.sales_denied(p_hotel_id,p_department_id,p_account_id,'sales-crm.write');
  end if;
  if existing.department_id<>p_department_id then return jsonb_build_object('error','INVALID_INPUT');end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','type','contactName','contactPhone','contactEmail','notes'))
   or exists(select 1 from jsonb_each(p_input) e where jsonb_typeof(e.value)<>'string')
   or not (p_input ? 'name' and p_input ? 'type')
   or length(trim(p_input->>'name')) not between 1 and 150
   or p_input->>'type' not in ('corporate','travel-agent','government','mice','wedding','other')
   or length(trim(coalesce(p_input->>'contactName','')))>100
   or length(trim(coalesce(p_input->>'notes','')))>1000 then return jsonb_build_object('error','INVALID_INPUT');end if;
  phone:=trim(coalesce(p_input->>'contactPhone',''));
  email:=lower(trim(coalesce(p_input->>'contactEmail','')));
  if phone<>'' and phone !~ '^[0-9+() .-]{4,40}$' then return jsonb_build_object('error','INVALID_PHONE');end if;
  if email<>'' and (length(email)>254 or email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then return jsonb_build_object('error','INVALID_EMAIL');end if;
  if p_account_id is null then
   insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_name,contact_phone,contact_email,notes,created_by,updated_by)
   values(p_hotel_id,p_department_id,trim(p_input->>'name'),p_input->>'type',trim(coalesce(p_input->>'contactName','')),phone,email,trim(coalesce(p_input->>'notes','')),auth.uid(),auth.uid()) returning * into account;
  else
   update public.sales_accounts set name=trim(p_input->>'name'),account_type=p_input->>'type',contact_name=trim(coalesce(p_input->>'contactName','')),contact_phone=phone,contact_email=email,notes=trim(coalesce(p_input->>'notes','')),
    version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
   where id=p_account_id returning * into account;
  end if;
 else
  update public.sales_accounts set status=case when p_action='archive' then 'archived' else 'active' end,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_account_id returning * into account;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,account.id,'sales-crm.account.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('id',account.id,'version',account.version));
end$$;

-- Deals sort by next follow-up (none last), then title. Without an account filter only
-- deals of active accounts are listed.
create function public.sales_deals_list(p_hotel_id uuid,p_department_id uuid default null,p_stage text default 'open',p_account_id uuid default null,p_follow_up text default 'any',p_search text default '',p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; after_date date; after_title text; today date:=workstel_private.sales_today();
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('sales-crm',p_hotel_id,d.id,'read')) then
  return workstel_private.sales_denied(p_hotel_id,p_department_id,p_account_id,'sales-crm.deals.list');
 end if;
 if p_stage is null or p_stage not in ('open','lead','proposal','negotiation','won','lost','all') or p_follow_up is null or p_follow_up not in ('any','overdue','week')
  or p_limit is null or p_limit<1 or p_limit>100 or p_search is null or length(p_search)>150 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select coalesce(next_follow_up,date '9999-12-31'),lower(title) into after_date,after_title from public.sales_deals where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) - 'sort_date' order by row_data.sort_date,lower(row_data.title),row_data.id),'[]'::jsonb) into result from (
  select s.id,s.hotel_id,s.department_id,d.name as department_name,s.account_id,a.name as account_name,s.title,s.segment,s.stage,s.value_amount,s.room_nights,
   s.arrival_date,s.departure_date,s.next_follow_up,s.lost_reason,s.notes,s.closed_at,s.version,s.updated_at,coalesce(s.next_follow_up,date '9999-12-31') as sort_date
  from public.sales_deals s join public.sales_accounts a on a.id=s.account_id
  join public.workstel_departments d on d.hotel_id=s.hotel_id and d.id=s.department_id
  where s.hotel_id=p_hotel_id and workstel_private.module_allowed('sales-crm',s.hotel_id,s.department_id,'read')
  and (p_department_id is null or s.department_id=p_department_id)
  and (case when p_account_id is null then a.status='active' else s.account_id=p_account_id end)
  and (p_stage='all' or s.stage=p_stage or (p_stage='open' and s.stage in ('lead','proposal','negotiation')))
  and (p_follow_up='any' or (s.stage in ('lead','proposal','negotiation') and
   case p_follow_up when 'overdue' then s.next_follow_up<today else s.next_follow_up between today and today+6 end))
  and (p_search='' or position(lower(p_search) in lower(s.title||' '||a.name))>0)
  and (after_title is null or (coalesce(s.next_follow_up,date '9999-12-31'),lower(s.title),s.id)>(after_date,after_title,p_after))
  order by coalesce(s.next_follow_up,date '9999-12-31'),lower(s.title),s.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_account_id,'sales-crm.deals.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('today',today,'nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

-- Adds or edits a deal with write access on its account's department. A deal stays on its
-- account; closing (won or lost) records closed_at and clears the follow-up date.
create function public.sales_deal_save(p_hotel_id uuid,p_input jsonb,p_deal_id uuid default null,p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare deal public.sales_deals; existing public.sales_deals; account public.sales_accounts; account_ref uuid;
 amount numeric; nights numeric; arrival date; departure date; follow_up date; new_stage text; reason text;
begin
 if p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('accountId','title','segment','stage','value','roomNights','arrivalDate','departureDate','nextFollowUp','lostReason','notes'))
  or not (p_input ? 'accountId' and p_input ? 'title' and p_input ? 'segment' and p_input ? 'stage' and p_input ? 'value')
  or exists(select 1 from unnest(array['accountId','title','segment','stage']) k where jsonb_typeof(p_input->k)<>'string')
  or exists(select 1 from unnest(array['lostReason','notes']) k where coalesce(jsonb_typeof(p_input->k),'string')<>'string')
  or jsonb_typeof(p_input->'value')<>'number' or coalesce(jsonb_typeof(p_input->'roomNights'),'null') not in ('number','null')
  or (p_input->>'accountId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 account_ref:=(p_input->>'accountId')::uuid;
 select * into account from public.sales_accounts where id=account_ref and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('sales-crm',account.hotel_id,account.department_id,'write') then
  return workstel_private.sales_denied(p_hotel_id,account.department_id,coalesce(p_deal_id,account_ref),'sales-crm.write');
 end if;
 if p_deal_id is not null then
  select * into existing from public.sales_deals where id=p_deal_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.module_allowed('sales-crm',existing.hotel_id,existing.department_id,'write') then
   return workstel_private.sales_denied(p_hotel_id,account.department_id,p_deal_id,'sales-crm.write');
  end if;
  if existing.account_id<>account.id then return jsonb_build_object('error','INVALID_INPUT');end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 elsif account.status<>'active' then return jsonb_build_object('error','ACCOUNT_ARCHIVED');
 end if;
 amount:=(p_input->>'value')::numeric;
 nights:=(p_input->>'roomNights')::numeric;
 arrival:=workstel_private.sales_date(p_input->'arrivalDate');
 departure:=workstel_private.sales_date(p_input->'departureDate');
 follow_up:=workstel_private.sales_date(p_input->'nextFollowUp');
 new_stage:=p_input->>'stage';
 reason:=trim(coalesce(p_input->>'lostReason',''));
 if length(trim(p_input->>'title')) not between 1 and 150
  or p_input->>'segment' not in ('corporate','group','mice','wedding','long-stay','other')
  or new_stage not in ('lead','proposal','negotiation','won','lost')
  or amount<>trunc(amount) or amount<0 or amount>1000000000000
  or (nights is not null and (nights<>trunc(nights) or nights<1 or nights>100000))
  or date '0001-01-01' in (arrival,departure,follow_up)
  or (departure is not null and (arrival is null or departure<arrival))
  or length(trim(coalesce(p_input->>'notes','')))>1000 or length(reason)>300 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if new_stage='lost' and reason='' then return jsonb_build_object('error','LOST_REASON_REQUIRED');end if;
 if new_stage<>'lost' then reason:='';end if;
 if new_stage in ('won','lost') then follow_up:=null;end if;
 if p_deal_id is null then
  insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,arrival_date,departure_date,next_follow_up,lost_reason,notes,closed_at,created_by,updated_by)
  values(p_hotel_id,account.department_id,account.id,trim(p_input->>'title'),p_input->>'segment',new_stage,amount::bigint,nights::integer,arrival,departure,follow_up,reason,trim(coalesce(p_input->>'notes','')),
   case when new_stage in ('won','lost') then clock_timestamp() end,auth.uid(),auth.uid()) returning * into deal;
 else
  update public.sales_deals set title=trim(p_input->>'title'),segment=p_input->>'segment',stage=new_stage,value_amount=amount::bigint,room_nights=nights::integer,
   arrival_date=arrival,departure_date=departure,next_follow_up=follow_up,lost_reason=reason,notes=trim(coalesce(p_input->>'notes','')),
   closed_at=case when new_stage not in ('won','lost') then null when existing.stage=new_stage then existing.closed_at else clock_timestamp() end,
   version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_deal_id returning * into deal;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,deal.department_id,deal.id,'sales-crm.deal.save','success');
 if deal.stage in ('won','lost') and (existing.id is null or existing.stage<>deal.stage) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,deal.department_id,deal.id,'sales-crm.deal.'||deal.stage,'success');
 end if;
 return jsonb_build_object('data',jsonb_build_object('id',deal.id,'version',deal.version));
end$$;

-- Activities of one account (optionally one deal), newest first.
create function public.sales_activities_list(p_hotel_id uuid,p_account_id uuid,p_deal_id uuid default null,p_after uuid default null,p_limit integer default 30)
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
  select x.id,x.account_id,x.deal_id,s.title as deal_title,x.activity_type,x.occurred_on,x.summary,x.created_at,coalesce(u.email,'') as created_by_email
  from public.sales_activities x left join public.sales_deals s on s.id=x.deal_id left join auth.users u on u.id=x.created_by
  where x.account_id=p_account_id and (p_deal_id is null or x.deal_id=p_deal_id)
  and (cursor_row.id is null or (x.occurred_on,x.created_at,x.id)<(cursor_row.occurred_on,cursor_row.created_at,cursor_row.id))
  order by x.occurred_on desc,x.created_at desc,x.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,account.department_id,p_account_id,'sales-crm.activities.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

-- Logs an activity (write). With a deal and nextFollowUp it also moves the deal's follow-up
-- date. Repeating the same idempotency key returns the first activity instead of a duplicate.
create function public.sales_activity_log(p_hotel_id uuid,p_account_id uuid,p_deal_id uuid,p_input jsonb,p_idempotency_key uuid)
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

revoke all on function public.sales_summary(uuid,uuid) from public,anon;
revoke all on function public.sales_accounts_list(uuid,uuid,text,text,text,uuid,integer) from public,anon;
revoke all on function public.sales_account_save(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.sales_deals_list(uuid,uuid,text,uuid,text,text,uuid,integer) from public,anon;
revoke all on function public.sales_deal_save(uuid,jsonb,uuid,integer) from public,anon;
revoke all on function public.sales_activities_list(uuid,uuid,uuid,uuid,integer) from public,anon;
revoke all on function public.sales_activity_log(uuid,uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function public.sales_summary(uuid,uuid) to authenticated;
grant execute on function public.sales_accounts_list(uuid,uuid,text,text,text,uuid,integer) to authenticated;
grant execute on function public.sales_account_save(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.sales_deals_list(uuid,uuid,text,uuid,text,text,uuid,integer) to authenticated;
grant execute on function public.sales_deal_save(uuid,jsonb,uuid,integer) to authenticated;
grant execute on function public.sales_activities_list(uuid,uuid,uuid,uuid,integer) to authenticated;
grant execute on function public.sales_activity_log(uuid,uuid,uuid,jsonb,uuid) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('sales-crm',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611040010') on conflict do nothing;
notify pgrst,'reload schema';
commit;
