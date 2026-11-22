import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Text } from '../../kit';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { usePageTitle } from '../../hooks/usePageTitle';
import { AdvisorError, callAdvisor } from './advisorClient';
import {
  type CheckCard, type CheckOutcome, endsIn, money, moneyShort, normalizePaste, pasteRefusal, priceLabel,
  railPct, railSpan, thinReason, toCheckOutcome, verdictLine,
} from './checkModel';
import './CheckPage.css';

/**
 * /check — paste a Bring a Trailer listing, get one card. Anonymous: it calls the public advisor scope the way any
 * visitor's MCP client does (advisorClient.ts). The card answers first (verdict, price, range, all-in); the evidence
 * (comps, the fee lines, what could not be checked) sits behind taps.
 */
const BAT_MARK = '/source-logos/bat.png';

type State =
  | { phase: 'idle' }
  | { phase: 'loading'; url: string; started: number }
  | { phase: 'done'; url: string; outcome: CheckOutcome; ms: number };

const CheckPage: React.FC = () => {
  usePageTitle('Check a listing');
  const [params, setParams] = useSearchParams();
  const urlParam = params.get('url') ?? '';
  const [draft, setDraft] = useState(urlParam);
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [photo, setPhoto] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (raw: string) => {
    abortRef.current?.abort();
    setPhoto(null);
    const refusal = pasteRefusal(raw);
    if (refusal) { setState({ phase: 'done', url: raw, outcome: { kind: 'refused', message: refusal }, ms: 0 }); return; }
    const url = normalizePaste(raw);
    const ac = new AbortController();
    abortRef.current = ac;
    const started = Date.now();
    setState({ phase: 'loading', url, started });
    try {
      const outcome = toCheckOutcome(await callAdvisor('evaluate_listing', { url }, ac.signal));
      if (ac.signal.aborted) return;
      setState({ phase: 'done', url, outcome, ms: Date.now() - started });
      if (outcome.kind === 'card' && outcome.matchedAssetId) {
        // The photo is a second, optional read: the card never waits for it.
        callAdvisor('get_asset', { asset_id: outcome.matchedAssetId }, ac.signal).then(r => {
          const links = (r.structuredContent?.links ?? null) as Record<string, unknown> | null;
          const src = typeof links?.primary_image_url === 'string' ? links.primary_image_url : null;
          if (!ac.signal.aborted && src && /^https:\/\//.test(src)) setPhoto(src);
        }, () => undefined);
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      const message = e instanceof AdvisorError ? e.message : 'The check did not finish. Try again.';
      setState({ phase: 'done', url, outcome: { kind: 'error', message }, ms: Date.now() - started });
    }
  }, []);

  useEffect(() => {
    if (urlParam) { setDraft(urlParam); run(urlParam); } else setState({ phase: 'idle' });
    return () => abortRef.current?.abort();
  }, [urlParam, run]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v) return;
    if (v === urlParam) run(v); else setParams({ url: v });
  };

  return (
    <main className="check-page">
      <header className="check-head">
        <Text role="entity" as="h1">Check a listing</Text>
        <Text role="caption" as="p">Paste a Bring a Trailer link. Nuke compares it with real sales.</Text>
      </header>

      <form className="check-form" onSubmit={submit} role="search">
        <label htmlFor="check-url" className="check-visually-hidden">Bring a Trailer listing link</label>
        <input
          id="check-url"
          className="check-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://bringatrailer.com/listing/…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onPaste={e => {
            const t = e.clipboardData.getData('text').trim();
            if (t) { e.preventDefault(); setDraft(t); setParams({ url: t }); }
          }}
        />
        <button className="check-go" type="submit" disabled={!draft.trim() || state.phase === 'loading'}>
          <Text role="measure" dense>Check</Text>
        </button>
      </form>

      <div aria-live="polite">
        {state.phase === 'loading' && <Loading started={state.started} />}
        {state.phase === 'done' && state.outcome.kind === 'refused' && (
          <section className="check-card check-card--message" aria-label="Not supported">
            <img className="check-message-mark" src={BAT_MARK} alt="" width={28} height={28} />
            <Text role="measure" as="p">Bring a Trailer only for now</Text>
            <Text role="body" as="p">{state.outcome.message.replace(/^Bring a Trailer only for now\.?\s*/i, '')}</Text>
          </section>
        )}
        {state.phase === 'done' && state.outcome.kind === 'error' && (
          <section className="check-card check-card--message" aria-label="Error">
            <Text role="measure" as="p">Couldn&rsquo;t check this listing</Text>
            <Text role="body" as="p">{state.outcome.message}</Text>
            <button className="check-retry" type="button" onClick={() => run(state.url)}><Text role="body">Try again</Text></button>
          </section>
        )}
        {state.phase === 'done' && state.outcome.kind === 'card' && <Card card={state.outcome} photo={photo} />}
      </div>
    </main>
  );
};

function Loading({ started }: { started: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.floor((Date.now() - started) / 1000);
  const step = s < 3 ? 'Reading the listing' : s < 9 ? 'Finding comparable sales' : 'Still working: some cars take longer to match';
  return (
    <section className="check-card check-card--loading" aria-label="Checking" aria-busy="true">
      <div className="check-skeleton check-skeleton--photo" />
      <div className="check-skeleton check-skeleton--line" />
      <div className="check-skeleton check-skeleton--line check-skeleton--short" />
      <Text role="caption" as="p">{step}…</Text>
    </section>
  );
}

function Card({ card, photo }: { card: CheckCard; photo: string | null }) {
  const span = railSpan(card);
  const ends = endsIn(card.endsAt);
  const [allComps, setAllComps] = useState(false);
  const comps = allComps ? card.comps : card.comps.slice(0, 3);
  return (
    <article className="check-card" aria-label={card.title}>
      {photo && (
        <a className="check-photo" href={card.url} target="_blank" rel="noopener noreferrer">
          <img src={photo} alt={card.title} width={640} height={400} loading="eager" onError={e => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />
        </a>
      )}

      <div className="check-identity">
        {card.make && card.model
          ? <VehicleIdentity year={card.year} make={card.make} model={card.model} compact />
          : <Text role="entity" as="h2">{card.title}</Text>}
        <a className="check-source" href={card.url} target="_blank" rel="noopener noreferrer">
          <img src={BAT_MARK} alt="" width={16} height={16} />
          <Text role="caption">{[...card.details, 'View on Bring a Trailer'].join(' · ')}</Text>
        </a>
      </div>

      <div className={`check-verdict check-verdict--${card.lowConfidence || card.priceKind === 'rnm' ? 'unknown' : card.relation ?? 'unknown'}`}>
        <Text role="measure" as="p">{verdictLine(card)}</Text>
      </div>

      <div className="check-money">
        <div>
          <Text role="label" as="p">{priceLabel(card)}</Text>
          <Text role="figure" as="p">{card.price != null ? money(card.price, card.currency) : card.priceKind === 'live' ? 'No bids yet' : '—'}</Text>
          <Text role="caption" as="p">{card.priceKind === 'live' ? [ends ?? 'live', card.relation === 'below' ? 'bids usually climb near the end' : null].filter(Boolean).join(' · ') : card.priceDate ?? ''}</Text>
        </div>
        {card.band && !card.lowConfidence && (
          <div>
            <Text role="label" as="p">Fair price</Text>
            <Text role="figure" as="p">{moneyShort(card.band.low)}–{moneyShort(card.band.high)}</Text>
            <Text role="caption" as="p">{card.band.n ? `from ${card.band.n} similar sales` : 'from similar sales'}</Text>
          </div>
        )}
      </div>

      {card.lowConfidence && (
        <div className="check-thin">
          <Text role="body" as="p">{thinReason(card)}</Text>
          {card.band && (
            <details className="check-more">
              <summary><Text role="body">See the rough range anyway</Text></summary>
              <Text role="measure" as="p">{money(card.band.low)}–{money(card.band.high)}</Text>
              <Text role="caption" as="p">Confidence {Math.round((card.band.confidence ?? 0) * 100)}%. Treat as a guess.</Text>
            </details>
          )}
        </div>
      )}

      {span && card.comps.length > 1 && (
        <figure className="check-rail" aria-label="Where this car sits among comparable sales">
          <svg className="check-rail__svg" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
            <line className="check-rail__track" x1="0" x2="100" y1="10" y2="10" vectorEffect="non-scaling-stroke" />
            {card.band && !card.lowConfidence && (
              <rect className="check-rail__band" x={railPct(card.band.low, span)} y="5" height="10"
                width={Math.max(0.8, railPct(card.band.high, span) - railPct(card.band.low, span))} rx="0" />
            )}
            {card.comps.map((c, i) => (
              <line key={i} className="check-rail__dot" x1={railPct(c.price, span)} x2={railPct(c.price, span)} y1="6" y2="14" vectorEffect="non-scaling-stroke" />
            ))}
            {card.price != null && card.currency === 'USD' && (
              <line className="check-rail__this" x1={railPct(card.price, span)} x2={railPct(card.price, span)} y1="0" y2="20" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          <figcaption>
            <Text role="caption">{moneyShort(span.min)}</Text>
            <Text role="caption">
              {card.position && card.price != null && card.currency === 'USD' ? positionText(card) : `${card.comps.length} comparable sales`}
            </Text>
            <Text role="caption">{moneyShort(span.max)}</Text>
          </figcaption>
        </figure>
      )}

      <dl className="check-facts">
        {card.trend && (
          <div className="check-fact">
            <dt><Text role="label">Trend</Text></dt>
            <dd>
              <Text role="measure">{card.trend.direction === 'flat' ? 'Flat' : `${card.trend.direction === 'up' ? 'Up' : 'Down'} ${Math.abs(card.trend.changePct).toFixed(1)}%`}</Text>
              <Text role="caption"> median {moneyShort(card.trend.recentMedian)} this year vs {moneyShort(card.trend.priorMedian)} the year before ({card.trend.recentN} and {card.trend.priorN} sales)</Text>
            </dd>
          </div>
        )}
        {card.allIn && (
          <div className="check-fact">
            <dt><Text role="label">{card.priceKind === 'sold' ? 'All-in paid' : 'All-in at this bid'}</Text></dt>
            <dd>
              <details className="check-more check-more--inline">
                <summary><Text role="measure">{money(card.allIn.total, card.currency)}</Text><Text role="caption">{card.allIn.lines.some(l => l.estimate) ? ' bid + fee + delivery' : ' bid + fee'}</Text></summary>
                <ul className="check-lines">
                  {card.allIn.lines.map(l => (
                    <li key={l.label}>
                      <Text role="caption">{l.sourceUrl ? <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer">{l.label}</a> : l.label}</Text>
                      <Text role="measure" dense>{money(l.amount, card.currency)}</Text>
                    </li>
                  ))}
                </ul>
              </details>
            </dd>
          </div>
        )}
      </dl>

      {card.comps.length > 0 && (
        <section className="check-comps" aria-label="Comparable sales">
          <Text role="label" as="h3">Comparable sales</Text>
          <ul>
            {comps.map(c => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  <img src={BAT_MARK} alt="Bring a Trailer" width={16} height={16} />
                  <span className="check-comp__title"><Text role="body">{c.title}</Text>{c.date && <Text role="caption">{c.date}</Text>}</span>
                  <Text role="measure" dense>{money(c.price)}</Text>
                </a>
              </li>
            ))}
          </ul>
          {card.comps.length > 3 && (
            <button type="button" className="check-showall" onClick={() => setAllComps(v => !v)} aria-expanded={allComps}>
              <Text role="body">{allComps ? 'Show fewer' : `Show all ${card.comps.length}`}</Text>
            </button>
          )}
        </section>
      )}

      {card.priorSales.length > 0 && (
        <section className="check-comps" aria-label="This car before">
          <Text role="label" as="h3">This car before</Text>
          <ul>
            {card.priorSales.map((p, i) => (
              <li key={i}>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    <span className="check-comp__title"><Text role="body">{p.label}</Text>{p.date && <Text role="caption">{p.date}</Text>}</span>
                    <Text role="measure" dense>{p.price != null ? money(p.price) : '—'}</Text>
                  </a>
                ) : (
                  <span className="check-row"><Text role="body">{p.label} {p.date ?? ''}</Text><Text role="measure" dense>{p.price != null ? money(p.price) : '—'}</Text></span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.notes.length > 0 && (
        <details className="check-more">
          <summary><Text role="body">What Nuke couldn&rsquo;t check ({card.notes.length})</Text></summary>
          <ul className="check-notes">{card.notes.map(n => <li key={n}><Text role="caption">{n.replace(/^Missing: /, 'No ')}</Text></li>)}</ul>
        </details>
      )}

      <Text role="caption" as="p" className="check-foot">
        From public Bring a Trailer records{card.asOf ? ` · ${new Date(card.asOf).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. Sale prices are hammer prices.
      </Text>
    </article>
  );
}

function positionText(c: CheckCard): string {
  const p = c.position!;
  const verb = c.priceKind === 'sold' ? 'Sold' : c.priceKind === 'rnm' ? 'High bid' : 'Bid';
  const above = Math.round((p.percentile / 100) * p.n);
  if (above >= p.n) return `${verb} above all ${p.n} comps`;
  if (above <= 0) return `${verb} below all ${p.n} comps`;
  return `${verb} above ${above} of ${p.n} comps`;
}

export default CheckPage;
