-- =====================================================
-- SEED: ESSENTIALS PACK (SAFE DEFAULTS)
-- =====================================================
-- Ships only text/sound-free reactions (no copyrighted media).
-- Date: 2025-12-15

begin;

insert into public.stream_action_packs (slug, name, description, price_cents, is_active)
values
  ('essentials', 'Essentials', 'Core reactions and meme glue. Text-only defaults; media is indexed separately.', 0, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  is_active = excluded.is_active,
  updated_at = now();

do $$
declare
  v_pack_id uuid;
begin
  select id into v_pack_id from public.stream_action_packs where slug = 'essentials';
  if v_pack_id is null then return; end if;

  insert into public.stream_actions (pack_id, slug, title, kind, render_text, image_url, sound_key, duration_ms, cooldown_ms, is_active)
  values
    (v_pack_id, 'bruh', 'Bruh', 'text_popup', 'BRUH', null, null, 1600, 4000, true),
    (v_pack_id, 'w', 'W', 'text_popup', 'W', null, null, 1200, 2500, true),
    (v_pack_id, 'l', 'L', 'text_popup', 'L', null, null, 1200, 2500, true),
    (v_pack_id, 'based', 'Based', 'text_popup', 'BASED', null, null, 1600, 4500, true),
    (v_pack_id, 'cringe', 'Cringe', 'text_popup', 'CRINGE', null, null, 1600, 4500, true),
    (v_pack_id, 'cap', 'Cap', 'text_popup', 'CAP', null, null, 1400, 3500, true),
    (v_pack_id, 'no_cap', 'No Cap', 'text_popup', 'NO CAP', null, null, 1600, 4500, true),
    (v_pack_id, 'send_it', 'Send It', 'text_popup', 'SEND IT', null, null, 1600, 4500, true),
    (v_pack_id, 'cooked', 'Cooked', 'text_popup', 'COOKED', null, null, 1600, 4500, true),
    (v_pack_id, 'let_him_cook', 'Let Him Cook', 'text_popup', 'LET HIM COOK', null, null, 1800, 6000, true),
    (v_pack_id, 'absolute_unit', 'Absolute Unit', 'text_popup', 'ABSOLUTE UNIT', null, null, 1800, 7000, true),
    (v_pack_id, 'npc', 'NPC', 'text_popup', 'NPC', null, null, 1600, 6000, true)
  on conflict (pack_id, slug) do update set
    title = excluded.title,
    kind = excluded.kind,
    render_text = excluded.render_text,
    image_url = excluded.image_url,
    sound_key = excluded.sound_key,
    duration_ms = excluded.duration_ms,
    cooldown_ms = excluded.cooldown_ms,
    is_active = excluded.is_active,
    updated_at = now();
end
$$;

commit;






