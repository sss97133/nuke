import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { MakeIdentity, VehicleIdentity } from '../../components/common/MakeIdentity';
import { CoverageView, Masthead, Text } from '../../kit';
import {
  type CalendarSale, type PriorResult, type RosterLot, daysUntil, houseLink, houseName, runTimer, saleTimer, updatedAgo,
  useAuctionCalendar, useSaleRoster,
} from './useAuctionCalendar';
import './RecordedSalesComparison.css';
import './AuctionEvidence.css';
import './AuctionCalendar.css';

// The scheduled auction sales on the calendar (owner, 2026-10-15): the same countdown as a live online auction, set
// months out, over a roster the house fills as cars are consigned. Each sale row draws its run days on one axis from
// today to the horizon; the first seven days are the window a 7-day online auction lives in. A sale opens its roster in
// place, by run day, and each consigned car shows what Nuke already recorded for it: many are resales.
const ONLINE_DAYS = 7;
const US_HOUSES = new Set(['mecum', 'barrett-jackson', 'barrettjackson', 'bat', 'cars_and_bids', 'pcarmarket']);
const count = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-US');

/** The viewer's clock to the minute: run-day timers change at midnight, "updated N min ago" each minute. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function dayLabel(day: string | null, withYear = false) {
  if (!day) return 'undated';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', withYear
    ? { month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}
function span(sale: CalendarSale) {
  return sale.starts_on === sale.ends_on ? dayLabel(sale.starts_on) : `${dayLabel(sale.starts_on)} to ${dayLabel(sale.ends_on)}`;
}
function money(amount: number | null, currency: string | null, house: string) {
  if (amount == null) return null;
  const code = currency ?? (US_HOUSES.has(house) ? 'USD' : null);
  const n = Math.round(amount).toLocaleString('en-US');
  return code === 'USD' ? `$${n}` : code ? `${code} ${n}` : `${n} (currency unrecorded)`;
}
function vehicleImage(value?: string | null) {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

/** One earlier record of the same car, in the source's own terms. A backfilled 'sold' without the house's result says so. */
function priorText(p: PriorResult) {
  const amount = money(p.amount, p.currency, p.house);
  const where = `${houseName(p.house)} · ${dayLabel(p.on, true)}`;
  if (p.outcome === 'sold') return p.basis === 'unconfirmed'
    ? `${where} · ${amount ?? 'no amount'} recorded, result unconfirmed`
    : `${where} · sold${amount ? ` ${amount}` : ', amount unrecorded'}`;
  if (p.outcome === 'not_sold') return `${where} · not sold${amount ? `, high bid ${amount}` : ''}`;
  if (p.outcome === 'listed') return `${where} · listed${amount ? ` at ${amount}` : ''}`;
  return `${where} · ${p.outcome}${amount ? `, ${amount} recorded` : ''}`;
}

/** The shared axis: today at the left edge, month starts, and the 7-day online window. Positions are percentages. */
function axisPct(day: string, now: number, horizon: number) {
  return Math.min(Math.max(daysUntil(day, now) / horizon, 0), 1) * 100;
}
function monthStarts(now: number, horizon: number) {
  const out: { day: string; label: string }[] = [];
  const d = new Date(now);
  for (let i = 1; i <= Math.ceil(horizon / 28) + 1; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
    const day = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`;
    if (daysUntil(day, now) > horizon) break;
    out.push({ day, label: m.toLocaleDateString('en-US', { month: 'short' }) + (m.getMonth() === 0 ? ` ${m.getFullYear()}` : '') });
  }
  return out;
}
function Axis({ now, horizon }: { now: number; horizon: number }) {
  return <svg className="auction-axis" width="100%" height="22" role="img"
    aria-label={`Calendar axis from today to ${horizon} days out; the first ${ONLINE_DAYS} days are the window of a 7-day online auction`}>
    <rect className="auction-axis__online" x="0" y="0" width={`${(ONLINE_DAYS / horizon) * 100}%`} height="22" />
    {monthStarts(now, horizon).map(m => { const x = `${axisPct(m.day, now, horizon)}%`;
      return <g key={m.day}><line className="auction-axis__tick" x1={x} x2={x} y1="0" y2="22" />
        <text className="auction-axis__label" x={x} dx="3" y="14">{m.label}</text></g>; })}
    <text className="auction-axis__label" x="0" dx="3" y="14">Today</text>
  </svg>;
}
function SaleTrack({ sale, now, horizon }: { sale: CalendarSale; now: number; horizon: number }) {
  const peak = Math.max(...sale.run_days.map(r => r.lots), 1);
  const start = axisPct(sale.starts_on, now, horizon), end = axisPct(sale.ends_on, now, horizon);
  const dayWidth = Math.max(100 / horizon, 0.4);
  return <svg className="auction-track" width="100%" height="28" role="img"
    aria-label={`${sale.sale_name}: ${span(sale)}; lots by run day ${sale.run_days.map(r => `${dayLabel(r.day)} ${r.lots}`).join(', ')}`}>
    <rect className="auction-track__online" x="0" y="0" width={`${(ONLINE_DAYS / horizon) * 100}%`} height="28" />
    <rect className="auction-track__span" x={`${start}%`} y="25" width={`${Math.max(end - start + dayWidth, dayWidth)}%`} height="3" />
    {sale.run_days.map(r => { const h = Math.max(Math.round((r.lots / peak) * 22), 2);
      return <rect key={r.day} className="auction-track__day" x={`${axisPct(r.day, now, horizon)}%`} y={25 - h} width={`${dayWidth}%`} height={h}>
        <title>{`${dayLabel(r.day)}: ${count(r.lots)} lots`}</title></rect>; })}
  </svg>;
}

function LotRow({ lot, house }: { lot: RosterLot; house: string }) {
  const image = vehicleImage(lot.image);
  const identity = [lot.year, lot.make, lot.model].filter(Boolean).join(' ');
  const page = houseLink(house, lot.source_url);
  const estimate = lot.estimate_low != null || lot.estimate_high != null
    ? `est. ${[money(lot.estimate_low, lot.currency, house), money(lot.estimate_high, lot.currency, house)].filter(Boolean).join(' to ')}` : null;
  const terms = [lot.lot_number ? `Lot ${lot.lot_number}` : null,
    lot.has_reserve === false ? 'no reserve' : lot.has_reserve === true ? 'reserve' : null, estimate].filter(Boolean).join(' · ');
  return <li className="auction-lot">
    {image && <img className="market-listing__image" src={image} width="80" height="60" loading="lazy" alt="Vehicle record image"
      onError={event => { event.currentTarget.hidden = true; }} />}
    <Text role="entity" dense as="div"><PrefetchLink to={`/vehicle/${lot.vehicle_id}`} aria-label={identity || 'Vehicle identity unrecorded'}>
      {lot.make && lot.model ? <VehicleIdentity year={lot.year} make={lot.make} model={lot.model} />
        : lot.make ? <>{lot.year ?? ''} <MakeIdentity make={lot.make} /></> : identity || 'Vehicle identity unrecorded'}
    </PrefetchLink></Text>
    <Text role="caption" as="div">{[terms || null, lot.vin_present ? 'VIN or chassis recorded' : 'no VIN recorded'].filter(Boolean).join(' · ')}
      {page && <> · <a href={page} target="_blank" rel="noopener noreferrer">{houseName(house)} lot page</a></>}</Text>
    {lot.prior.length > 0
      ? <ul className="auction-lot__prior" aria-label="Earlier records of this vehicle">
        {lot.prior.map((p, i) => { const href = houseLink(p.house, p.url);
          return <li key={`${p.house}-${p.on}-${i}`}><Text role="caption">{href
            ? <a href={href} target="_blank" rel="noopener noreferrer">{priorText(p)}</a> : priorText(p)}</Text></li>; })}
      </ul>
      : <Text role="caption" as="div">No earlier record of this vehicle on Nuke</Text>}
  </li>;
}

function Roster({ sale, now }: { sale: CalendarSale; now: number }) {
  const query = useSaleRoster({ house: sale.house, key: sale.sale_key });
  const pages = query.data?.pages ?? [];
  const roster = pages[0]?.roster;
  const rows = pages.flatMap(page => page.roster?.rows ?? []);
  const days = rows.reduce<Map<string, RosterLot[]>>((m, lot) => m.set(lot.run_on, [...(m.get(lot.run_on) ?? []), lot]), new Map());
  const byDay = new Map(sale.run_days.map(r => [r.day, r.lots]));
  if (query.isPending) return <p role="status" className="k-body">Reading the roster…</p>;
  if (!query.isError && rows.length === 0) return <p role="status" className="k-body">No lot of this sale has landed yet{sale.lots_listed != null ? `; ${houseName(sale.house)} lists ${count(sale.lots_listed)}` : ''}.</p>;
  if (query.isError) return <p role="status" className="k-body">The roster could not be read. <button type="button" className="market-control"
    onClick={() => void query.refetch()}><Text role="label">Retry</Text></button></p>;
  return <div className="auction-roster" aria-label={`${sale.sale_name} roster`}>
    <CoverageView c={{ n: rows.length, of: roster?.lots ?? sale.lots, grain: 'lots landed for this sale', as_of: sale.updated_at }} />
    {[...days.entries()].map(([day, lots]) => <Fragment key={day}>
      <div className="auction-roster__day">
        <Text role="label">{dayLabel(day)}</Text>
        <Text role="caption">{count(byDay.get(day) ?? lots.length)} lots · {runTimer(day, now)}</Text>
      </div>
      <ul className="auction-roster__lots">{lots.map(lot => <LotRow key={lot.event_id} lot={lot} house={sale.house} />)}</ul>
    </Fragment>)}
    {query.hasNextPage && <button type="button" className="market-control" disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}><Text role="label">{query.isFetchingNextPage ? 'Reading…' : 'More lots'}</Text></button>}
  </div>;
}

export default function AuctionCalendar({ collection }: { collection?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const now = useMinute();
  const query = useAuctionCalendar();
  const data = query.data;
  const population = data?.population;
  const selected = params.get('sale');
  const choose = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set('sale', key); else next.delete('sale');
    setParams(next, { replace: true });
  };
  // Draw to the last sale landed (plus a week), never past the reader's horizon.
  const lastDay = data?.sales.reduce((n, s) => Math.max(n, daysUntil(s.ends_on, now)), 0) ?? 0;
  const horizon = Math.min(Math.max(lastDay + 7, 30), data?.horizon_days ?? 200);

  return <section aria-label="Auction calendar" className="market-explorer">
    <Masthead result={<>
      <Text role="measure" as="div">{population ? (population.listed > population.lots
        ? `${count(population.lots)} of ${count(population.listed)} lots` : `${count(population.lots)} ${population.lots === 1 ? 'lot' : 'lots'}`) : '…'}</Text>
      <Text role="caption" as="div">{data && population
        ? `${population.listed > population.lots ? 'landed of the lots the houses list, ' : ''}on ${count(population.sales)} scheduled ${population.sales === 1 ? 'sale' : 'sales'} from ${count(population.houses)} ${population.houses === 1 ? 'house' : 'houses'} in the next ${data.horizon_days} days · ${count(population.seen_before)} with an earlier record on Nuke · ${updatedAgo(population.updated_at, now)}`
        : 'reading the calendar…'}</Text>
    </>}>
      <Text role="entity" as="h1">Auction calendar</Text>
    </Masthead>
    <div className="k-section k-strip market-scope" role="group" aria-label="Calendar scope">
      <div role="group" aria-label="Market view" className="market-scope__views">{collection}</div>
      <Text role="caption" className="market-scope__note">
        Live sales publish their rosters weeks to months ahead; a lot lands here when the house lists it and leaves if it is withdrawn.
        Timers count days to the house's run day. The shaded band is the {ONLINE_DAYS}-day window an online auction runs in.
      </Text>
    </div>
    {query.isPending && <p role="status" className="k-body">Reading the calendar…</p>}
    {query.isError && <p role="status" className="k-body">The calendar could not be read. <button type="button" className="market-control"
      onClick={() => void query.refetch()}><Text role="label">Retry</Text></button></p>}
    {data && data.sales.length === 0 && <p role="status" className="k-body">No scheduled sale has a lot landed for the next {data.horizon_days} days.</p>}
    {data && data.sales.length > 0 && <div className="market-listings__scroll"><table className="market-listings auction-calendar">
      <thead><tr>
        <th scope="col"><Text role="label">Gavel</Text></th>
        <th scope="col"><Text role="label">Sale</Text></th>
        <th scope="col"><Text role="label">Roster</Text></th>
        <th scope="col" className="auction-calendar__axis"><Axis now={now} horizon={horizon} /></th>
      </tr></thead>
      <tbody>{data.sales.map(sale => {
        const key = `${sale.house}:${sale.sale_key}`;
        const open = selected === key;
        return <Fragment key={key}>
          <tr className="auction-sale">
            <td><button type="button" className="auction-sale__open" aria-expanded={open} onClick={() => choose(open ? null : key)}
              aria-label={`${open ? 'Close' : 'Open'} the roster of ${houseName(sale.house)} ${sale.sale_name}`}>
              <Text role="measure" dense as="div">{saleTimer(sale.starts_on, sale.ends_on, now)}</Text>
              <Text role="caption" as="div">{span(sale)}</Text>
            </button></td>
            <td><button type="button" className="auction-sale__open" aria-expanded={open} onClick={() => choose(open ? null : key)}>
              <Text role="label" as="div">{houseName(sale.house)}</Text>
              <Text role="entity" dense as="div">{sale.sale_name}</Text>
              {sale.location && <Text role="caption" as="div">{sale.location}</Text>}</button></td>
            <td><Text role="measure" dense as="div">{sale.lots_listed != null && sale.lots_listed !== sale.lots
                ? `${count(sale.lots)} of ${count(sale.lots_listed)} lots` : `${count(sale.lots)} ${sale.lots === 1 ? 'lot' : 'lots'}`}</Text>
              {sale.lots_listed != null && <Text role="caption" as="div">{houseName(sale.house)} lists {count(sale.lots_listed)}, {updatedAgo(sale.listed_at, now).replace('updated', 'read')}</Text>}
              {/* A sale with no lot landed has nothing to count beyond what the house lists. */}
              {sale.lots > 0 && <Text role="caption" as="div">{count(sale.first_seen_7d)} first seen in the last 7 days · {updatedAgo(sale.updated_at, now)}</Text>}
              {sale.lots > 0 && <Text role="caption" as="div">{count(sale.seen_before)} with an earlier record · {count(sale.no_reserve)} no reserve</Text>}</td>
            <td className="auction-calendar__axis"><SaleTrack sale={sale} now={now} horizon={horizon} /></td>
          </tr>
          {open && <tr className="auction-sale__roster"><td colSpan={4}><Roster sale={sale} now={now} /></td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>}
    {data?.unplaced && data.unplaced.length > 0 && <Text role="caption" as="p" className="auction-unplaced">
      Also listed, days and lots not landed yet: {data.unplaced.map(u => `${houseName(u.house)} ${u.sale_name}, ${count(u.lots_listed)} lots`).join(' · ')}
    </Text>}
  </section>;
}
