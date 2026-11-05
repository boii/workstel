begin;
-- Self-service staff profile. Only the signed-in user reads and writes their own row; there is
-- no cross-user read. Name, title and extension changes are audited without their values.
create table workstel_private.user_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text check(display_name is null or char_length(display_name) between 1 and 80),
 job_title text check(job_title is null or char_length(job_title) between 1 and 80),
 extension text check(extension is null or extension ~ '^[0-9+()# -]{1,20}$'),
 locale text check(locale is null or locale in ('en','id')),
 updated_at timestamptz not null default clock_timestamp()
);
alter table workstel_private.user_profiles enable row level security;
revoke all on workstel_private.user_profiles from public,anon,authenticated;

create function workstel_private.profile_json(p workstel_private.user_profiles)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('displayName',p.display_name,'jobTitle',p.job_title,'extension',p.extension,'locale',p.locale)
$$;
revoke all on function workstel_private.profile_json(workstel_private.user_profiles) from public,anon,authenticated;

create function public.workstel_profile_get()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p workstel_private.user_profiles;
begin
 if auth.uid() is null then return jsonb_build_object('error','ACCESS_DENIED');end if;
 select * into p from workstel_private.user_profiles where user_id=auth.uid();
 return jsonb_build_object('data',workstel_private.profile_json(p));
end$$;

-- Partial update: only keys present in p_input change. An empty string clears a field.
create function public.workstel_profile_save(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 old_row workstel_private.user_profiles;
 new_row workstel_private.user_profiles;
 key text;
 item jsonb;
 clean text;
begin
 if auth.uid() is null then return jsonb_build_object('error','ACCESS_DENIED');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or p_input='{}'::jsonb then
  return jsonb_build_object('error','INVALID_INPUT');
 end if;
 select * into old_row from workstel_private.user_profiles where user_id=auth.uid();
 if found then new_row:=old_row;
 else new_row:=row(auth.uid(),null,null,null,null,clock_timestamp())::workstel_private.user_profiles;
 end if;
 for key,item in select * from jsonb_each(p_input) loop
  if jsonb_typeof(item) not in ('string','null') then return jsonb_build_object('error','INVALID_INPUT');end if;
  clean:=nullif(btrim(item #>> '{}'),'');
  if clean ~ '[[:cntrl:]]' then return jsonb_build_object('error','INVALID_INPUT');end if;
  case key
   when 'displayName' then
    if char_length(clean)>80 then return jsonb_build_object('error','INVALID_INPUT');end if;
    new_row.display_name:=clean;
   when 'jobTitle' then
    if char_length(clean)>80 then return jsonb_build_object('error','INVALID_INPUT');end if;
    new_row.job_title:=clean;
   when 'extension' then
    if clean !~ '^[0-9+()# -]{1,20}$' then return jsonb_build_object('error','INVALID_INPUT');end if;
    new_row.extension:=clean;
   when 'locale' then
    if clean not in ('en','id') then return jsonb_build_object('error','INVALID_INPUT');end if;
    new_row.locale:=clean;
   else return jsonb_build_object('error','INVALID_INPUT');
  end case;
 end loop;
 insert into workstel_private.user_profiles(user_id,display_name,job_title,extension,locale,updated_at)
 values(auth.uid(),new_row.display_name,new_row.job_title,new_row.extension,new_row.locale,clock_timestamp())
 on conflict(user_id) do update set display_name=excluded.display_name,job_title=excluded.job_title,
  extension=excluded.extension,locale=excluded.locale,updated_at=excluded.updated_at;
 -- Language is a preference; identity fields are audited, without their values.
 if (old_row.display_name,old_row.job_title,old_row.extension)
    is distinct from (new_row.display_name,new_row.job_title,new_row.extension) then
  insert into workstel_private.audit_events(actor_id,resource_id,action,outcome)
  values(auth.uid(),auth.uid(),'platform.profile.update','success');
 end if;
 return jsonb_build_object('data',workstel_private.profile_json(new_row));
end$$;
revoke all on function public.workstel_profile_get() from public,anon;
revoke all on function public.workstel_profile_save(jsonb) from public,anon;
grant execute on function public.workstel_profile_get() to authenticated;
grant execute on function public.workstel_profile_save(jsonb) to authenticated;

insert into workstel_private.schema_migrations(version) values ('202611050002') on conflict do nothing;
notify pgrst,'reload schema';
commit;
