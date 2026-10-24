Run fx_boc_cad_v1_20261024: table public.fx_boc_cad_usd_v1_20261024 (4,869 rows, 2007-05-01..2026-10-23) from the Bank of Canada Valet API:
IEXE0101 (legacy noon USD, to 2016-12-30) and FXUSDCAD (daily average, from 2017-01-03), https://www.bankofcanada.ca/valet/observations/<series>/json.
usd_per_cad = 1 / cad_per_usd. Additive table; fx_rates untouched. The load SQL (~240 KB inline values) is kept out of the repo; regenerate from the API.
