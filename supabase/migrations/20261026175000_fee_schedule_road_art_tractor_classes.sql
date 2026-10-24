-- Mecum Road Art and tractor fee classes.
-- Source: Mecum Gone Farmin' Fall Premier 2022 bidder registration (https://cdn1.mecum.com/assets/pdfs/GN1122-printable-registration-form.pdf,
-- read 2026-10-24, sha256 53241d6e...): BUYER'S PREMIUM onsite / absentee - Tractors 5% / 7%, Road Art & Relics 18% / 20%;
-- "Buyer's Premiums are automatically added to the final hammer price upon settlement."
-- Mecum's own published sold prices fit the onsite rates: Road Art 18% (2012-2024), tractors 5%.
-- Current https://www.mecum.com/faq/ (read 2026-10-24): "Road Art: In Person 20%" -> 20% row from the citation date.
SET lock_timeout = '5s';

alter table public.platform_fee_schedule drop constraint if exists platform_fee_schedule_lot_class_check;
alter table public.platform_fee_schedule add constraint platform_fee_schedule_lot_class_check
  check (lot_class = any (array['any','car','motorcycle','non_car','charity','road_art','tractor'])) not valid;
alter table public.platform_fee_schedule validate constraint platform_fee_schedule_lot_class_check;

insert into public.platform_fee_schedule (platform, role, fee_kind, rate, currency, published_price_basis,
  valid_from, valid_to, source_url, notes, tier_floor, lot_class, cited_on, history_verified, sale_type)
select 'mecum', 'buyer', 'percent', v.rate, 'USD', 'gross_incl_premium', v.vf, v.vt, v.url, v.note, 0, v.cls, '2026-10-24', v.hv, 'any'
  from (values
    ('road_art', 0.18::numeric, null::timestamptz, '2026-10-24T00:00:00Z'::timestamptz, 'https://cdn1.mecum.com/assets/pdfs/GN1122-printable-registration-form.pdf',
     'Road Art & Relics onsite 18% (absentee 20%) per Mecum GN1122 registration form; published prices fit 18% 2012-2024; hammer = gross / 1.18', true),
    ('road_art', 0.20, '2026-10-24T00:00:00Z', null, 'https://www.mecum.com/faq/',
     'Road Art In Person 20% per mecum.com/faq read 2026-10-24; start = citation date (earlier start not established)', false),
    ('tractor', 0.05, null, null, 'https://cdn1.mecum.com/assets/pdfs/GN1122-printable-registration-form.pdf',
     'Tractors onsite 5% (absentee 7%) per Mecum GN1122 registration form; published prices fit 5%; hammer = gross / 1.05', true)
  ) v(cls, rate, vf, vt, url, note, hv)
 where not exists (select 1 from public.platform_fee_schedule f where f.platform = 'mecum' and f.role = 'buyer' and f.lot_class = v.cls
                     and f.rate = v.rate and f.valid_from is not distinct from v.vf);
