import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Masthead, Section, Text } from '../kit';
import { usePageTitle } from '../hooks/usePageTitle';
import { parseEvidence, type Evidence } from './aboutEvidence';
import './About.css';

/**
 * What Nuke is, in the one voice of docs/POSITIONING.md, with the evidence a stranger can check.
 * The grading table is the block the daily stats job writes into that document, loaded here as the
 * document itself; the page carries no number of its own.
 */
const REPO = 'https://github.com/sss97133/nuke';

// The repository's docs/POSITIONING.md, outside this package: the build runs from the whole checkout (deploy-vercel.yml).
const loadEvidence = () => import('../../../docs/POSITIONING.md?raw').then(m => parseEvidence(m.default));

const About: React.FC = () => {
  usePageTitle('About');
  const [evidence, setEvidence] = useState<Evidence | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadEvidence().then(e => { if (live) setEvidence(e); }, () => { if (live) setEvidence(null); });
    return () => { live = false; };
  }, []);
  const lead = evidence?.models[0];

  return (
    <main className="about-page">
      <Masthead result={<Text role="caption">pre-launch · vehicles are the first asset class</Text>}>
        <Text role="entity" as="h1">Nuke</Text>
        <Text role="body" className="about-sentence">an observational ledger for physical assets, with its predictions graded in the open</Text>
      </Masthead>

      <section className="k-section about-block" aria-label="What Nuke is">
        <Text role="body" as="p">
          Nuke is a data machine for physical assets. Every observation about an asset (a bid, a comment, a photo, a receipt,
          a title transfer) is kept with its source, its clocks and its trust, and the system computes the asset&rsquo;s state,
          its cohort baseline and its predictions from that log, point-in-time, so every number can be replayed and graded.
        </Text>
      </section>

      {evidence && lead && (
        <Section
          title="What you can check"
          coverage={{ n: lead.graded, of: lead.ended, grain: `lots graded, model ${lead.model}`, as_of: evidence.measuredAt }}
        >
          <Text role="body" as="p">{evidence.preface}</Text>
          <div className="about-table-wrap">
            <table className="about-grades" aria-label="Graded models">
              <thead>
                <tr>{evidence.columns.map(c => <th key={c} scope="col"><Text role="label">{c}</Text></th>)}</tr>
              </thead>
              <tbody>
                {evidence.models.map(m => (
                  <tr key={m.model}>
                    {m.cells.map((cell, i) => (
                      <td key={i}>{i === 0 ? <Text role="measure" dense>{cell}</Text> : <Text role="caption">{cell}</Text>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {evidence.notes.length > 0 && (
            <dl className="about-rows">
              {evidence.notes.map((n, i) => (
                <React.Fragment key={i}>
                  <dt><Text role="label">{n.title || 'note'}</Text></dt>
                  <dd><Text role="body">{n.text}</Text></dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </Section>
      )}
      {evidence === null && (
        <section className="k-section about-block" aria-label="What you can check">
          <Text role="label" as="h2">What you can check</Text>
          <Text role="body" as="p">
            The grading table did not load here. It is the evidence block of <a href={`${REPO}/blob/main/docs/POSITIONING.md`}>docs/POSITIONING.md</a>,
            rewritten daily from the live database.
          </Text>
        </section>
      )}

      <section className="k-section about-block" aria-label="Where to look">
        <Text role="label" as="h2">Where to look</Text>
        <dl className="about-rows">
          <dt><Text role="label">The market</Text></dt>
          <dd><Text role="body"><Link to="/?tab=market">The live board</Link>: the ledger&rsquo;s map by make, the money on the board, and every open lot with its recorded bids and its heat against its comparables.</Text></dd>
          <dt><Text role="label">The journal</Text></dt>
          <dd><Text role="body"><Link to="/journal">What the ledger recorded</Link>, day by day.</Text></dd>
          <dt><Text role="label">Search</Text></dt>
          <dd><Text role="body"><Link to="/search">A vehicle, a VIN or a listing URL</Link>.</Text></dd>
          <dt><Text role="label">The code</Text></dt>
          <dd><Text role="body"><a href={REPO}>The public repository</a>, with a README measured daily from the same database, and <Link to="/api">the API</Link>.</Text></dd>
        </dl>
      </section>

      <section className="k-section about-block" aria-label="Who">
        <Text role="label" as="h2">Who</Text>
        <Text role="body" as="p">
          A pre-launch small business founded by a mechanic who builds and sells vehicles and is the system&rsquo;s first user.
          The engineering is run with AI coding agents under a public repository and a written engineering law.
        </Text>
      </section>

      <section className="k-section about-block" aria-label="What it is not">
        <Text role="label" as="h2">What it is not</Text>
        <Text role="body" as="p">
          Not a price guide. The number a buyer gets today arrives with no error table. Here every number carries its source,
          its date, its unit and its denominator, and every prediction is graded against the outcome in the table above.
        </Text>
        <Text role="body" as="p">
          Not a marketplace. Nothing is listed or sold here. The venues are sources, and a sale is one more observation.
        </Text>
        <Text role="body" as="p">
          Not a model&rsquo;s opinion. A language or vision model is a sensor: it turns a comment into an attributed claim or a
          photo into a condition observation, and its output lands as a row with its provenance. It never produces the number.
          The ledger is the instrument.
        </Text>
      </section>
    </main>
  );
};

export default About;
