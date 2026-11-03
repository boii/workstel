begin;
-- Bin Card: department stock items with an append-only movement ledger.
create table public.bin_card_items(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 code text not null check(code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
 name text not null check(length(trim(name)) between 1 and 150),
 unit text not null check(unit in ('pcs','box','pack','bottle','roll','set','kg','g','l','ml','m')),
 location text not null default '' check(length(location)<=100),
 min_quantity numeric(14,3) not null default 0 check(min_quantity>=0),
 balance numeric(14,3) not null default 0 check(balance>=0),
 status text not null default 'active' check(status in ('active','archived')),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create unique index bin_card_items_code_idx on public.bin_card_items(hotel_id,department_id,code);
create index bin_card_items_scope_idx on public.bin_card_items(hotel_id,department_id,status,lower(name),id);
create table public.bin_card_entries(
 id uuid primary key default gen_random_uuid(),hotel_id uuid not null,department_id uuid not null,
 item_id uuid not null references public.bin_card_items(id),
 entry_type text not null check(entry_type in ('receipt','issue','adjustment')),
 quantity numeric(14,3) not null check(quantity<>0),balance_after numeric(14,3) not null check(balance_after>=0),
 reference text not null default '' check(length(reference)<=60),notes text not null default '' check(length(notes)<=500),
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null references auth.users(id),
 idempotency_key uuid not null,unique(created_by,idempotency_key),
 check((entry_type='receipt' and quantity>0) or (entry_type='issue' and quantity<0) or entry_type='adjustment'),
 foreign key(hotel_id,department_id) references public.workstel_departments(hotel_id,id)
);
create index bin_card_entries_item_idx on public.bin_card_entries(item_id,created_at desc,id desc);
alter table public.bin_card_items enable row level security;
alter table public.bin_card_entries enable row level security;
revoke all on public.bin_card_items,public.bin_card_entries from public,anon,authenticated;

create function workstel_private.reject_bin_card_entry_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'Bin card entries are append-only';end$$;
create trigger bin_card_entries_append_only before update or delete on public.bin_card_entries
 for each row execute function workstel_private.reject_bin_card_entry_change();

-- Quantities are non-negative decimals with at most three fraction digits.
create function workstel_private.bin_card_quantity(p_value jsonb)
returns numeric language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value)='number' and p_value::text ~ '^[0-9]{1,11}(\.[0-9]{1,3})?$' then p_value::text::numeric else null end $$;
revoke all on function workstel_private.bin_card_quantity(jsonb) from public,anon,authenticated;

create function public.bin_card_list_items(p_hotel_id uuid,p_department_id uuid default null,p_status text default 'active',p_search text default '',p_low_only boolean default false,p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; after_name text;
begin
 if not exists(select 1 from public.workstel_departments d where d.hotel_id=p_hotel_id and (p_department_id is null or d.id=p_department_id) and workstel_private.module_allowed('bin-card',p_hotel_id,d.id,'read')) then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'bin-card.item.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_status is null or p_status not in ('active','archived','all') or p_low_only is null or p_limit is null or p_limit<1 or p_limit>100 or p_search is null or length(p_search)>150 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_after is not null then select lower(name) into after_name from public.bin_card_items where id=p_after and hotel_id=p_hotel_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by lower(row_data.name),row_data.id),'[]'::jsonb) into result from (
  select b.id,b.hotel_id,b.department_id,d.code as department_code,d.name as department_name,b.code,b.name,b.unit,b.location,b.min_quantity,b.balance,b.status,b.version,b.created_at,b.updated_at
  from public.bin_card_items b join public.workstel_departments d on d.hotel_id=b.hotel_id and d.id=b.department_id
  where b.hotel_id=p_hotel_id and workstel_private.module_allowed('bin-card',b.hotel_id,b.department_id,'read')
  and (p_department_id is null or b.department_id=p_department_id)
  and (p_status='all' or b.status=p_status)
  and (not p_low_only or b.balance<=b.min_quantity)
  and (p_search='' or position(lower(p_search) in lower(b.code||' '||b.name||' '||b.location))>0)
  and (after_name is null or (lower(b.name),b.id)>(after_name,p_after))
  order by lower(b.name),b.id limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,'bin-card.item.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

create function public.bin_card_save_item(p_hotel_id uuid,p_department_id uuid,p_input jsonb,p_item_id uuid default null,p_expected_version integer default null,p_action text default 'save')
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.bin_card_items; existing public.bin_card_items; item_code text; minimum numeric;
begin
 if not workstel_private.module_allowed('bin-card',p_hotel_id,p_department_id,'manage') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_item_id,'bin-card.item.write','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_action is null or p_action not in ('save','archive','restore') or (p_action<>'save' and p_item_id is null) then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_item_id is not null then
  select * into existing from public.bin_card_items where id=p_item_id and hotel_id=p_hotel_id for update;
  if not found or not workstel_private.module_allowed('bin-card',existing.hotel_id,existing.department_id,'manage') then
   insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,p_department_id,p_item_id,'bin-card.item.write','denied');
   return jsonb_build_object('error','ACCESS_DENIED');
  end if;
  if p_expected_version is null or existing.version<>p_expected_version then return jsonb_build_object('error','VERSION_CONFLICT');end if;
 end if;
 if p_action='save' then
  if p_input is null or jsonb_typeof(p_input)<>'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('code','name','unit','location','minQuantity'))
   or jsonb_typeof(p_input->'code') is distinct from 'string' or jsonb_typeof(p_input->'name') is distinct from 'string'
   or jsonb_typeof(p_input->'unit') is distinct from 'string'
   or (p_input ? 'location' and jsonb_typeof(p_input->'location')<>'string')
   or length(trim(p_input->>'name')) not between 1 and 150 or length(trim(coalesce(p_input->>'location','')))>100
   or p_input->>'unit' not in ('pcs','box','pack','bottle','roll','set','kg','g','l','ml','m') then return jsonb_build_object('error','INVALID_INPUT');end if;
  item_code:=upper(trim(p_input->>'code'));
  minimum:=case when p_input ? 'minQuantity' then workstel_private.bin_card_quantity(p_input->'minQuantity') else 0 end;
  if item_code !~ '^[A-Z0-9][A-Z0-9._-]{0,29}$' or minimum is null then return jsonb_build_object('error','INVALID_INPUT');end if;
  -- The unit is fixed once stock has moved, so historical quantities keep their meaning.
  if p_item_id is not null and existing.unit<>p_input->>'unit' and exists(select 1 from public.bin_card_entries e where e.item_id=p_item_id) then
   return jsonb_build_object('error','UNIT_LOCKED');
  end if;
  -- Stock cannot move between departments; their ledgers are separate.
  if p_item_id is not null and existing.department_id<>p_department_id and exists(select 1 from public.bin_card_entries e where e.item_id=p_item_id) then
   return jsonb_build_object('error','DEPARTMENT_LOCKED');
  end if;
  begin
   if p_item_id is null then
    insert into public.bin_card_items(hotel_id,department_id,code,name,unit,location,min_quantity,created_by,updated_by)
    values(p_hotel_id,p_department_id,item_code,trim(p_input->>'name'),p_input->>'unit',trim(coalesce(p_input->>'location','')),minimum,auth.uid(),auth.uid()) returning * into item;
   else
    update public.bin_card_items set department_id=p_department_id,code=item_code,name=trim(p_input->>'name'),unit=p_input->>'unit',location=trim(coalesce(p_input->>'location','')),min_quantity=minimum,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
    where id=p_item_id returning * into item;
   end if;
  exception when unique_violation then
   return jsonb_build_object('error','DUPLICATE_CODE');
  end;
 else
  if p_action='archive' and existing.balance<>0 then return jsonb_build_object('error','BALANCE_NOT_ZERO');end if;
  update public.bin_card_items set status=case when p_action='archive' then 'archived' else 'active' end,version=version+1,updated_at=clock_timestamp(),updated_by=auth.uid()
  where id=p_item_id returning * into item;
 end if;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,item.department_id,item.id,'bin-card.item.'||p_action,'success');
 return jsonb_build_object('data',jsonb_build_object('id',item.id,'version',item.version));
end$$;

-- Receipts and issues take a positive quantity; an adjustment takes the counted balance.
create function public.bin_card_record_entry(p_hotel_id uuid,p_item_id uuid,p_input jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.bin_card_items; entry public.bin_card_entries; amount numeric; delta numeric; kind text;
begin
 select * into item from public.bin_card_items where id=p_item_id and hotel_id=p_hotel_id for update;
 if not found or not workstel_private.module_allowed('bin-card',item.hotel_id,item.department_id,'write') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,item.department_id,p_item_id,'bin-card.entry.create','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_idempotency_key is null then return jsonb_build_object('error','INVALID_INPUT');end if;
 select * into entry from public.bin_card_entries where created_by=auth.uid() and idempotency_key=p_idempotency_key;
 if found then
  if entry.item_id<>p_item_id then return jsonb_build_object('error','INVALID_INPUT');end if;
  return jsonb_build_object('data',jsonb_build_object('id',entry.id,'balance',entry.balance_after));
 end if;
 if item.status<>'active' then return jsonb_build_object('error','ITEM_ARCHIVED');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object'
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('type','quantity','reference','notes'))
  or jsonb_typeof(p_input->'type') is distinct from 'string' or p_input->>'type' not in ('receipt','issue','adjustment')
  or (p_input ? 'reference' and (jsonb_typeof(p_input->'reference')<>'string' or length(trim(p_input->>'reference'))>60))
  or (p_input ? 'notes' and (jsonb_typeof(p_input->'notes')<>'string' or length(trim(p_input->>'notes'))>500))
  then return jsonb_build_object('error','INVALID_INPUT');end if;
 kind:=p_input->>'type';
 amount:=workstel_private.bin_card_quantity(p_input->'quantity');
 if amount is null or (kind<>'adjustment' and amount=0) then return jsonb_build_object('error','INVALID_INPUT');end if;
 delta:=case kind when 'receipt' then amount when 'issue' then -amount else amount-item.balance end;
 if kind='adjustment' and delta=0 then return jsonb_build_object('error','NO_CHANGE');end if;
 if item.balance+delta<0 then return jsonb_build_object('error','INSUFFICIENT_STOCK');end if;
 if item.balance+delta>99999999999.999 then return jsonb_build_object('error','INVALID_INPUT');end if;
 insert into public.bin_card_entries(hotel_id,department_id,item_id,entry_type,quantity,balance_after,reference,notes,created_by,idempotency_key)
 values(item.hotel_id,item.department_id,item.id,kind,delta,item.balance+delta,trim(coalesce(p_input->>'reference','')),trim(coalesce(p_input->>'notes','')),auth.uid(),p_idempotency_key)
 returning * into entry;
 -- The balance is a server-maintained total; it does not change the item's edit version.
 update public.bin_card_items set balance=entry.balance_after where id=item.id;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),item.hotel_id,item.department_id,entry.id,'bin-card.entry.'||kind,'success');
 return jsonb_build_object('data',jsonb_build_object('id',entry.id,'balance',entry.balance_after));
end$$;

create function public.bin_card_list_entries(p_hotel_id uuid,p_item_id uuid,p_before uuid default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.bin_card_items; result jsonb; before_at timestamptz;
begin
 select * into item from public.bin_card_items where id=p_item_id and hotel_id=p_hotel_id;
 if not found or not workstel_private.module_allowed('bin-card',item.hotel_id,item.department_id,'read') then
  insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),p_hotel_id,item.department_id,p_item_id,'bin-card.entry.list','denied');
  return jsonb_build_object('error','ACCESS_DENIED');
 end if;
 if p_limit is null or p_limit<1 or p_limit>50 then return jsonb_build_object('error','INVALID_INPUT');end if;
 if p_before is not null then select created_at into before_at from public.bin_card_entries where id=p_before and item_id=p_item_id; end if;
 select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc,row_data.id desc),'[]'::jsonb) into result from (
  select e.id,e.item_id,e.entry_type,e.quantity,e.balance_after,e.reference,e.notes,e.created_at,e.created_by,u.email as created_by_email
  from public.bin_card_entries e left join auth.users u on u.id=e.created_by
  where e.item_id=p_item_id and (before_at is null or (e.created_at,e.id)<(before_at,p_before))
  order by e.created_at desc,e.id desc limit p_limit
 ) row_data;
 insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome) values(auth.uid(),item.hotel_id,item.department_id,item.id,'bin-card.entry.list','success');
 return jsonb_build_object('data',result,'meta',jsonb_build_object('nextCursor',case when jsonb_array_length(result)=p_limit then result->-1->>'id' else null end));
end$$;

revoke all on function public.bin_card_list_items(uuid,uuid,text,text,boolean,uuid,integer) from public,anon;
revoke all on function public.bin_card_save_item(uuid,uuid,jsonb,uuid,integer,text) from public,anon;
revoke all on function public.bin_card_record_entry(uuid,uuid,jsonb,uuid) from public,anon;
revoke all on function public.bin_card_list_entries(uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.bin_card_list_items(uuid,uuid,text,text,boolean,uuid,integer) to authenticated;
grant execute on function public.bin_card_save_item(uuid,uuid,jsonb,uuid,integer,text) to authenticated;
grant execute on function public.bin_card_record_entry(uuid,uuid,jsonb,uuid) to authenticated;
grant execute on function public.bin_card_list_entries(uuid,uuid,uuid,integer) to authenticated;

insert into workstel_private.installed_modules(module_id,schema_version) values ('bin-card',1) on conflict do nothing;
insert into workstel_private.schema_migrations(version) values ('202611040003') on conflict do nothing;
notify pgrst,'reload schema';
commit;
