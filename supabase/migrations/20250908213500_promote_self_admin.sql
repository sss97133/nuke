-- One-time bootstrap: allow first admin self-promotion
-- Safely promotes current user to admin IF no admin or moderator exists yet.

create or replace function public.promote_self_admin()
returns json
language plpgsql
security definer
as $$
declare
  has_admin boolean;
  me uuid;
begin
  -- Determine if any admin/moderator exists
  select exists (
    select 1 from public.profiles where user_type in ('admin','moderator')
  ) into has_admin;

  if has_admin then
    return json_build_object('ok', false, 'message', 'Admin already exists');
  end if;

  me := auth.uid();
  if me is null then
    return json_build_object('ok', false, 'message', 'Not authenticated');
  end if;

  -- Ensure profile row
  insert into public.profiles (id, email, user_type, updated_at)
  values (me, null, 'admin', now())
  on conflict (id) do update set user_type = 'admin', updated_at = now();

  return json_build_object('ok', true, 'message', 'Promoted to admin');
end;
$$;
