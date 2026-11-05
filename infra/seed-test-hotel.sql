-- Seed a separate "Workstel Test Hotel" with dummy records that cover the UI states of every
-- implemented module: empty and long text, every status, category, stage and unit, low and
-- zero stock, overdue follow-ups, archived records, read-only grants and list pagination.
--
-- Run as the database owner after all migrations are installed. The email must belong to an
-- existing dedicated test account (create it on the Users page first) that has no access to
-- any other hotel, because the web app opens the first hotel in a user's access list:
--   docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres \
--     -v email=test.account@hotel.example < seed-test-hotel.sql
-- Remove everything again with remove-test-hotel.sql. Access grants made here are recorded
-- as staff.access.* and staff.module-access.* audit events. No Vault secrets are created.
begin;
select set_config('workstel.seed_email', :'email', true);

create or replace function pg_temp.items(p_issues text[] default '{}')
returns jsonb language sql immutable as $$
 select jsonb_object_agg(k, case when k = any(p_issues) then 'issue' else 'ok' end)
 from unnest(array['exterior','tires','lights','brakes','wipers','horn','interior','air-conditioning','documents','safety-kit']) k $$;

do $seed$
declare
 h constant uuid := '7e570000-0000-4000-8000-000000000001';
 u uuid;
 d_fo uuid; d_sales uuid; d_eng uuid; d_it uuid; d_acc uuid; d_hk uuid;
 v uuid; it uuid; acc uuid; deal uuid; room uuid; va uuid;
 bal numeric; qty numeric; i integer;
 today date := (now() at time zone 'Asia/Jakarta')::date;
begin
 select id into u from auth.users where lower(email) = lower(current_setting('workstel.seed_email'));
 if u is null then raise exception 'No account with email %; create the test account first', current_setting('workstel.seed_email'); end if;
 if exists(select 1 from workstel_private.staff_access where user_id = u and hotel_id <> h) then
  raise exception 'This account already has access to another hotel. Use a dedicated test account so the app opens the test hotel.';
 end if;
 if exists(select 1 from public.workstel_hotels where id = h) then
  raise exception 'The test hotel already exists. Run remove-test-hotel.sql first to reseed it.';
 end if;

 insert into public.workstel_hotels(id, name) values (h, 'Workstel Test Hotel');
 insert into public.workstel_departments(hotel_id, code, name) values
  (h,'front-office','Front Office'),(h,'sales','Sales & Marketing'),(h,'engineering','Engineering'),
  (h,'it','IT'),(h,'accounting','Accounting'),(h,'human-resource','Human Resource'),
  (h,'admin-general','Admin and General'),(h,'housekeeping','Housekeeping');
 select id into d_fo from public.workstel_departments where hotel_id = h and code = 'front-office';
 select id into d_sales from public.workstel_departments where hotel_id = h and code = 'sales';
 select id into d_eng from public.workstel_departments where hotel_id = h and code = 'engineering';
 select id into d_it from public.workstel_departments where hotel_id = h and code = 'it';
 select id into d_acc from public.workstel_departments where hotel_id = h and code = 'accounting';
 select id into d_hk from public.workstel_departments where hotel_id = h and code = 'housekeeping';

 -- Access: full rights in most departments, edit without archive in Engineering, read-only
 -- in Accounting, and no access to Human Resource or Admin and General.
 insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive,can_audit) values
  (u,h,d_fo,true,true,true,true),(u,h,d_sales,true,true,true,true),(u,h,d_eng,true,true,false,false),
  (u,h,d_it,true,true,true,true),(u,h,d_acc,true,false,false,false),(u,h,d_hk,true,true,true,false);
 insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values
  (u,h,d_fo,'vehicle',true,true,true),(u,h,d_eng,'vehicle',true,true,false),
  (u,h,d_fo,'bin-card',true,true,true),(u,h,d_eng,'bin-card',true,true,true),(u,h,d_hk,'bin-card',true,false,false),
  (u,h,d_fo,'documents',true,true,true),(u,h,d_eng,'documents',true,true,false),(u,h,d_sales,'documents',true,false,false),
  (u,h,d_hk,'documents',true,true,true),
  (u,h,d_sales,'sales-crm',true,true,true),(u,h,d_fo,'sales-crm',true,false,false),
  (u,h,d_hk,'room-turnaround',true,true,true),(u,h,d_fo,'room-turnaround',true,false,false);

 -- Vehicle Checklist ------------------------------------------------------------------
 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
  values (h,d_fo,'Toyota Hiace Commuter','B 1234 TST',u,u) returning id into v;
 insert into public.vehicle_inspections(hotel_id,department_id,vehicle_id,inspected_at,inspected_by,odometer_km,fuel_level,items,result,notes,idempotency_key) values
  (h,d_fo,v,now()-interval '10 days',u,48210,'quarter',pg_temp.items(array['tires','wipers']),'attention','Front left tyre worn; wipers streak.',gen_random_uuid()),
  (h,d_fo,v,now()-interval '5 days',u,48990,'three-quarters',pg_temp.items(),'pass','',gen_random_uuid()),
  (h,d_fo,v,now()-interval '2 hours',u,49312,'full',pg_temp.items(),'pass','Ready for airport pickup.',gen_random_uuid());
 update public.vehicle_units set last_inspected_at = now()-interval '2 hours', last_result = 'pass' where id = v;

 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
  values (h,d_fo,'Toyota Innova Reborn','B 2345 TST',u,u) returning id into v;
 insert into public.vehicle_inspections(hotel_id,department_id,vehicle_id,inspected_at,inspected_by,odometer_km,fuel_level,items,result,notes,idempotency_key) values
  (h,d_fo,v,now()-interval '1 day',u,null,'empty',pg_temp.items(array['brakes','lights','air-conditioning','safety-kit']),'attention',
   'Brake pedal soft, left headlight out, AC blows warm air and the first-aid kit is missing. Do not use for guests until Engineering signs off.',gen_random_uuid());
 update public.vehicle_units set last_inspected_at = now()-interval '1 day', last_result = 'attention' where id = v;

 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
  values (h,d_fo,'Daihatsu Gran Max','B 3456 TST',u,u);
 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
  values (h,d_fo,'Mitsubishi Xpander Ultimate Cross Airport Shuttle with Extended Luggage Rack and Rear Camera','B 9999 TST-LONGPLATE',u,u)
  returning id into v;
 insert into public.vehicle_inspections(hotel_id,department_id,vehicle_id,inspected_at,inspected_by,odometer_km,fuel_level,items,result,notes,idempotency_key)
  values (h,d_fo,v,now()-interval '3 days',u,9999999,'half',pg_temp.items(),'pass',repeat('Long note to test wrapping. ',35),gen_random_uuid());
 update public.vehicle_units set last_inspected_at = now()-interval '3 days', last_result = 'pass' where id = v;

 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,status,created_by,updated_by)
  values (h,d_fo,'Suzuki Carry (retired)','B 4567 TST','archived',u,u) returning id into v;
 insert into public.vehicle_inspections(hotel_id,department_id,vehicle_id,inspected_at,inspected_by,odometer_km,fuel_level,items,result,notes,idempotency_key)
  values (h,d_fo,v,now()-interval '40 days',u,182000,'quarter',pg_temp.items(),'pass','',gen_random_uuid());
 update public.vehicle_units set last_inspected_at = now()-interval '40 days', last_result = 'pass' where id = v;

 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
  values (h,d_eng,'Engineering Pickup L300','B 5678 TST',u,u) returning id into v;
 insert into public.vehicle_inspections(hotel_id,department_id,vehicle_id,inspected_at,inspected_by,odometer_km,fuel_level,items,result,notes,idempotency_key)
  values (h,d_eng,v,now()-interval '3 days',u,77120,'half',pg_temp.items(array['horn']),'attention','Horn intermittent.',gen_random_uuid());
 update public.vehicle_units set last_inspected_at = now()-interval '3 days', last_result = 'attention' where id = v;
 insert into public.vehicle_units(hotel_id,department_id,name,plate_number,created_by,updated_by)
  values (h,d_eng,'Golf Cart 01','GC-01',u,u);

 -- Bin Card: balances are rebuilt from the ledger so every balance_after stays consistent.
 create temporary table seed_bin(code text, dept uuid, name text, unit text, location text, min_qty numeric, status text, moves jsonb) on commit drop;
 insert into seed_bin values
  ('LIN-01',d_fo,'Bath towel','pcs','Linen room A',50,'active','[["receipt",200,"PO-1001",20],["issue",-80,"",15],["issue",-60,"Banquet",10],["adjustment",-2,"COUNT-0501",5]]'),
  ('LIN-02',d_fo,'Hand towel','pcs','Linen room A',40,'active','[["receipt",60,"PO-1002",12],["issue",-35,"",3]]'),
  ('AMN-01',d_fo,'Shampoo 30 ml','bottle','Store room 2',100,'active','[["receipt",120,"PO-1003",9],["issue",-120,"",1]]'),
  ('AMN-02',d_fo,'Dental kit','set','Store room 2',0,'active','[["receipt",300,"PO-1004",7]]'),
  ('STA-01',d_fo,'Printer paper A4','box','',5,'active','[["receipt",12,"",6]]'),
  ('FO.LONG-CODE_2026-XYZ',d_fo,repeat('Very long item name for wrapping tests ',3)||'end','pack',repeat('Shelf ',16)||'end',10,'active','[["receipt",25,"PO-LONG-REFERENCE-NUMBER-0001",4]]'),
  ('ARC-01',d_fo,'Old key cards','pcs','Front desk drawer',0,'archived','[["receipt",50,"",30],["issue",-50,"Returned to vendor",25]]'),
  ('ENG-11',d_eng,'LED bulb 9 W','pcs','Engineering store',10,'active','[]'),
  ('ENG-20',d_eng,'Pool chlorine','kg','Chemical store',20,'active','[["receipt",50.5,"PO-2001",14],["issue",-12.25,"",8],["adjustment",0.125,"COUNT-0502",2]]'),
  ('ENG-21',d_eng,'Wall paint white','l','Engineering store',5,'active','[["receipt",8,"",20],["issue",-4.5,"Room 204",11]]'),
  ('ENG-30',d_eng,'Cable ties 20 cm','pack','Engineering store',3,'active','[["receipt",10,"",9]]'),
  ('ENG-40',d_eng,'Bearing grease','g','Engineering store',500,'active','[["receipt",1000,"",13],["issue",-250,"",2]]'),
  ('ENG-41',d_eng,'Electrical cable 2.5 mm','m','Engineering store',50,'active','[["receipt",150,"",15],["issue",-29.5,"Lobby",1]]'),
  ('HK-01',d_hk,'Toilet roll','roll','Housekeeping store',100,'active','[["receipt",600,"PO-3001",10],["issue",-150,"",2]]'),
  ('HK-02',d_hk,'Glass cleaner','ml','Housekeeping store',2000,'active','[["receipt",5000,"",9],["issue",-3500,"",1]]');
 declare r record; m jsonb;
 begin
  for r in select * from seed_bin loop
   insert into public.bin_card_items(hotel_id,department_id,code,name,unit,location,min_quantity,created_by,updated_by)
    values (h,r.dept,r.code,r.name,r.unit,r.location,r.min_qty,u,u) returning id into it;
   bal := 0;
   for m in select * from jsonb_array_elements(r.moves) loop
    qty := (m->>1)::numeric; bal := bal + qty;
    insert into public.bin_card_entries(hotel_id,department_id,item_id,entry_type,quantity,balance_after,reference,notes,created_at,created_by,idempotency_key)
     values (h,r.dept,it,m->>0,qty,bal,m->>2,case when m->>0='adjustment' then 'Stock count correction' else '' end,
             now()-make_interval(days=>(m->>3)::int),u,gen_random_uuid());
   end loop;
   update public.bin_card_items set balance = bal, status = r.status where id = it;
  end loop;
 end;
 -- One item with a long ledger to exercise "Load more".
 insert into public.bin_card_items(hotel_id,department_id,code,name,unit,location,min_quantity,created_by,updated_by)
  values (h,d_fo,'PAG-01','Coffee capsules','pcs','Pantry',30,u,u) returning id into it;
 bal := 0;
 for i in 1..65 loop
  qty := case when i % 3 = 1 then 40 else -12 end;
  if bal + qty < 0 then qty := 40; end if;
  bal := bal + qty;
  insert into public.bin_card_entries(hotel_id,department_id,item_id,entry_type,quantity,balance_after,reference,created_at,created_by,idempotency_key)
   values (h,d_fo,it,case when qty > 0 then 'receipt' else 'issue' end,qty,bal,'BATCH-'||lpad(i::text,3,'0'),now()-make_interval(hours=>(66-i)*6),u,gen_random_uuid());
 end loop;
 update public.bin_card_items set balance = bal where id = it;

 -- Documents & SOPs: every category, archived, long and empty text, and enough rows to page.
 insert into public.documents_links(hotel_id,department_id,title,category,url,description,status,created_by,updated_by) values
  (h,d_fo,'Guest check-in SOP','sop','https://docs.example.com/workstel-test/check-in','Arrival, ID check and key handover.','active',u,u),
  (h,d_fo,'Lost and found policy','policy','https://docs.example.com/workstel-test/lost-found','','active',u,u),
  (h,d_fo,'Daily room inspection form','form','https://docs.example.com/workstel-test/inspection-form','Print one per floor.','active',u,u),
  (h,d_fo,'Night audit guide','guide','https://docs.example.com/workstel-test/night-audit','Step-by-step for the night shift.','active',u,u),
  (h,d_fo,'Staff parking map','other','https://docs.example.com/workstel-test/parking?floor=B1#map','','active',u,u),
  (h,d_fo,'Old check-out SOP (2019)','sop','https://docs.example.com/workstel-test/old-check-out','Replaced by the 2026 version.','archived',u,u),
  (h,d_fo,repeat('Extremely long document title for wrapping ',3)||'end','guide','https://docs.example.com/workstel-test/'||repeat('long-path/',30)||'end',repeat('Long description to test wrapping and truncation. ',9)||'end','active',u,u),
  (h,d_hk,'Room cleaning standard','sop','https://docs.example.com/workstel-test/room-cleaning','Departure and make-up room checklists.','active',u,u),
  (h,d_hk,'Chemical safety sheet','policy','https://docs.example.com/workstel-test/chemical-safety','','active',u,u),
  (h,d_sales,'Corporate rate card 2027','other','https://docs.example.com/workstel-test/rate-card','Read-only for this account.','active',u,u),
  (h,d_eng,'Chiller maintenance','guide','https://docs.example.com/workstel-test/chiller','Monthly and yearly tasks.','active',u,u),
  (h,d_eng,'Hot work permit','form','https://docs.example.com/workstel-test/hot-work','','archived',u,u);
 insert into public.documents_links(hotel_id,department_id,title,category,url,description,created_by,updated_by)
  select h,d_eng,'Engineering work instruction '||lpad(n::text,2,'0'),(array['sop','guide','form'])[1+n%3],
         'https://docs.example.com/workstel-test/wi-'||n,case when n%2=0 then 'Generated for pagination tests.' else '' end,u,u
  from generate_series(1,45) n;

 -- Sales CRM: every account type and deal stage, follow-ups around today, and activities.
 insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_name,contact_phone,contact_email,notes,created_by,updated_by)
  values (h,d_sales,'PT Nusantara Energi','corporate','Rina Kusuma','+62 812-1111-2222','rina@nusantara-energi.example','Annual corporate rate holder.',u,u) returning id into acc;
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,arrival_date,departure_date,next_follow_up,created_by,updated_by)
  values (h,d_sales,acc,'Annual leadership meeting','mice','negotiation',1250000000,600,today+40,today+44,today+20,u,u) returning id into deal;
 insert into public.sales_activities(hotel_id,department_id,account_id,deal_id,activity_type,occurred_on,summary,created_by,idempotency_key) values
  (h,d_sales,acc,deal,'site-inspection',today-12,'Toured ballroom and breakout rooms with the events team.',u,gen_random_uuid()),
  (h,d_sales,acc,deal,'email',today-6,'Sent revised proposal with a 10% group discount.',u,gen_random_uuid()),
  (h,d_sales,acc,null,'note',today-1,repeat('Long note for wrapping. ',40),u,gen_random_uuid());
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,next_follow_up,closed_at,created_by,updated_by)
  values (h,d_sales,acc,'Corporate rate 2026','corporate','won',320000000,1200,null,now()-interval '2 days',u,u);

 insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_name,contact_phone,created_by,updated_by)
  values (h,d_sales,'Sinar Tour & Travel','travel-agent','Budi Santoso','021 555 0101',u,u) returning id into acc;
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,arrival_date,departure_date,next_follow_up,created_by,updated_by)
  values (h,d_sales,acc,'Group series December','group','lead',96000000,160,today+35,today+37,today-3,u,u) returning id into deal;
 insert into public.sales_activities(hotel_id,department_id,account_id,deal_id,activity_type,occurred_on,summary,created_by,idempotency_key)
  values (h,d_sales,acc,deal,'call',today-9,'Asked for allotment of 40 rooms per night.',u,gen_random_uuid());
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,next_follow_up,created_by,updated_by)
  values (h,d_sales,acc,'Weekend packages','other','proposal',0,today,u,u);

 insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_email,created_by,updated_by)
  values (h,d_sales,'Kementerian Pariwisata','government','events@kemenpar.example',u,u) returning id into acc;
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,arrival_date,next_follow_up,created_by,updated_by)
  values (h,d_sales,acc,'Regional tourism forum','mice','proposal',185000000,240,today+60,today+5,u,u) returning id into deal;
 insert into public.sales_activities(hotel_id,department_id,account_id,deal_id,activity_type,occurred_on,summary,created_by,idempotency_key)
  values (h,d_sales,acc,deal,'meeting',today-4,'Presented package options to the procurement team.',u,gen_random_uuid());

 insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_name,created_by,updated_by)
  values (h,d_sales,'Bintang Wedding Organizer','wedding','Sari Dewi',u,u) returning id into acc;
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,arrival_date,departure_date,next_follow_up,created_by,updated_by)
  values (h,d_sales,acc,'Garden wedding package','wedding','lead',145000000,30,today+90,today+91,null,u,u);
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,lost_reason,closed_at,created_by,updated_by)
  values (h,d_sales,acc,'Ballroom reception June','wedding','lost',210000000,'Client chose a venue with a larger ballroom.',now()-interval '20 days',u,u);
 insert into public.sales_activities(hotel_id,department_id,account_id,activity_type,occurred_on,summary,created_by,idempotency_key)
  values (h,d_sales,acc,'visit',today-2,'Dropped off the wedding brochure.',u,gen_random_uuid());

 insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_name,contact_phone,contact_email,notes,created_by,updated_by)
  values (h,d_sales,'Global Consulting Long-Stay','corporate','Andreas Wijaya','(021) 7788-9900','andreas@global-consulting.example','Expat project team.',u,u) returning id into acc;
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,arrival_date,departure_date,next_follow_up,created_by,updated_by)
  values (h,d_sales,acc,'Project team 6 months','long-stay','lead',890000000,540,today+14,today+194,today+1,u,u);

 insert into public.sales_accounts(hotel_id,department_id,name,account_type,created_by,updated_by)
  values (h,d_sales,'Komunitas Lari Jakarta','other',u,u);
 insert into public.sales_accounts(hotel_id,department_id,name,account_type,notes,created_by,updated_by)
  values (h,d_sales,repeat('Very long account name for wrapping ',4)||'end','corporate',repeat('Long account notes to test wrapping. ',26)||'end',u,u);
 insert into public.sales_accounts(hotel_id,department_id,name,account_type,contact_name,status,created_by,updated_by)
  values (h,d_sales,'PT Lama Sejahtera (archived)','corporate','Former contact','archived',u,u) returning id into acc;
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,lost_reason,closed_at,created_by,updated_by)
  values (h,d_sales,acc,'Meeting package 2025','corporate','lost',45000000,'Company relocated.',now()-interval '200 days',u,u);
 insert into public.sales_deals(hotel_id,department_id,account_id,title,segment,stage,value_amount,room_nights,closed_at,created_by,updated_by)
  values (h,d_sales,(select id from public.sales_accounts where hotel_id=h and name='Sinar Tour & Travel'),'Group series August','group','won',72000000,120,now()-interval '45 days',u,u);

 -- Room Turnaround: three floors and a villa without a floor, an archived room, one running
 -- timer, and finished or cancelled cleanings across several days.
 insert into public.room_turnaround_rooms(hotel_id,department_id,room_number,floor,room_type,created_by,updated_by)
  select h,d_hk,r.n,r.f,r.t,u,u from (values
   ('101','1','Deluxe'),('102','1','Deluxe'),('103','1','Superior'),('104','1','Superior'),('105','1',''),
   ('201','2','Deluxe'),('202','2','Suite'),('203','2','Deluxe'),('204','2','Superior'),
   ('1001','10','Presidential Suite'),('1002','10','Suite'),('VILLA-A','','Pool villa'),('VILLA-B','','Pool villa')) r(n,f,t);
 insert into public.room_turnaround_rooms(hotel_id,department_id,room_number,floor,room_type,archived,created_by,updated_by)
  values (h,d_hk,'106','1','Closed for renovation',true,u,u);
 select id into room from public.room_turnaround_rooms where hotel_id=h and room_number='101';
 insert into public.room_turnaround_tasks(hotel_id,department_id,room_id,task_type,status,attendant_id,started_at)
  values (h,d_hk,room,'make-up','active',u,now()-interval '14 minutes');
 insert into public.room_turnaround_tasks(hotel_id,department_id,room_id,task_type,status,attendant_id,started_at,finished_at,paused_seconds,duration_seconds)
  select h,d_hk,r.id,x.t,'done',u,now()-x.ago,now()-x.ago+x.took+make_interval(secs=>x.paused),x.paused,extract(epoch from x.took)::int
  from (values
   ('102','departure',interval '3 hours',interval '38 minutes',0),
   ('103','make-up',interval '2 hours',interval '17 minutes',300),
   ('201','departure',interval '5 hours',interval '2 hours 15 minutes',0),
   ('202','make-up',interval '90 minutes',interval '3 minutes',0),
   ('1001','other',interval '6 hours',interval '55 minutes',600),
   ('VILLA-A','departure',interval '26 hours',interval '47 minutes',0),
   ('204','make-up',interval '28 hours',interval '21 minutes',0),
   ('106','departure',interval '3 days',interval '33 minutes',0),
   ('1002','departure',interval '4 days',interval '41 minutes',120)) x(n,t,ago,took,paused)
  join public.room_turnaround_rooms r on r.hotel_id=h and r.room_number=x.n;
 insert into public.room_turnaround_tasks(hotel_id,department_id,room_id,task_type,status,attendant_id,started_at,finished_at)
  select h,d_hk,id,'make-up','cancelled',u,now()-interval '4 hours',now()-interval '3 hours 55 minutes'
  from public.room_turnaround_rooms where hotel_id=h and room_number='203';

 -- Password Vault metadata only: no secret values are seeded.
 insert into public.vault_accounts(hotel_id,department_id,name,username,website,notes,owner_id,created_by,updated_by)
  values (h,d_it,'Hotel Wi-Fi controller','wifi-admin','https://192.168.10.1','Shared with Front Office for guest resets.',u,u,u) returning id into va;
 insert into workstel_private.vault_department_shares(account_id,department_id,granted_by) values (va,d_fo,u);
 insert into public.vault_accounts(hotel_id,department_id,name,username,website,notes,owner_id,created_by,updated_by) values
  (h,d_fo,'Booking.com extranet','reservations@test-hotel.example','https://admin.booking.com','',u,u,u),
  (h,d_fo,'Door lock system','fo-supervisor','',repeat('Long Vault note for wrapping. ',30)||'end',u,u,u),
  (h,d_it,'Cloud backup console','backup-ops','https://backup.example.com/console','',u,u,u);
 insert into public.vault_accounts(hotel_id,department_id,name,username,website,notes,status,owner_id,created_by,updated_by)
  values (h,d_it,'Old PMS login','pms-legacy','https://old-pms.example.com','Retired in 2025.','archived',u,u,u);
end
$seed$;

select d.code as department, count(*) as granted_modules
from workstel_private.module_access m join public.workstel_departments d on d.id = m.department_id
where m.hotel_id = '7e570000-0000-4000-8000-000000000001' group by d.code order by d.code;
commit;
