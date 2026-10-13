-- Atomically create a company and make the caller its owner.
-- SECURITY DEFINER so it bypasses the chicken-and-egg RLS problem on first company.
create or replace function public.create_company(p_name text, p_trade text, p_timezone text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into companies (name, trade, timezone)
  values (p_name, nullif(p_trade, ''), coalesce(nullif(p_timezone, ''), 'America/Denver'))
  returning id into cid;
  insert into memberships (company_id, user_id, role, display_name)
  values (cid, auth.uid(), 'owner', p_display_name);
  return cid;
end;
$$;

revoke execute on function public.create_company(text, text, text, text) from anon, public;
grant execute on function public.create_company(text, text, text, text) to authenticated;
