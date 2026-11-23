/**
 * Make and make/model cohort hubs. Lists only year-grain make_model_profiles
 * rows; no prices are shown here (those live on the year terminal).
 *
 * Routes: /cohort, /cohort/:make, /cohort/:make/:model
 */
import React from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePageTitle } from '../hooks/usePageTitle';
import { Masthead, Text } from '../kit';
import {
  groupProfiles,
  parseCohortHubPath,
  parseYearProfile,
  type YearProfile,
} from '../lib/cohortHubs';
import { cohortMakePath, cohortModelPath, cohortPath, displayToken } from '../lib/cohortReport';

function useYearProfiles() {
  return useQuery<YearProfile[]>({
    queryKey: ['cohort-hub-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('make_model_profiles')
        .select('canonical_make, canonical_model, year, updated_at')
        .eq('grain', 'year')
        .not('year', 'is', null);
      if (error) throw error;
      return (data ?? []).map(parseYearProfile).filter((r): r is YearProfile => r != null);
    },
    staleTime: 5 * 60 * 1000,
  });
}

const CohortHub: React.FC = () => {
  const params = useParams<{ make?: string; model?: string }>();
  const location = useLocation();
  const hub = parseCohortHubPath(location.pathname) ?? (params.make && params.model
    ? { kind: 'model' as const, make: params.make, model: params.model }
    : params.make
      ? { kind: 'make' as const, make: params.make }
      : { kind: 'index' as const });
  const { data: rows, isError, isPending } = useYearProfiles();

  const title = hub.kind === 'index'
    ? 'Vehicle cohorts'
    : hub.kind === 'make'
      ? `${displayToken(hub.make)} cohorts`
      : `${displayToken(hub.make)} ${displayToken(hub.model)} years`;
  usePageTitle(title);

  if (isPending) {
    return (
      <main>
        <Masthead>
          <Text role="entity" as="h1">{title}</Text>
          <Text role="body">Reading registered year pages…</Text>
        </Masthead>
      </main>
    );
  }
  if (isError) {
    return (
      <main>
        <Masthead>
          <Text role="entity" as="h1">{title}</Text>
          <Text role="body">The year-page directory could not be read. Try again, or open a year URL directly if you have one.</Text>
        </Masthead>
      </main>
    );
  }

  const all = rows ?? [];
  if (hub.kind === 'index') {
    const groups = groupProfiles(all);
    return (
      <main>
        <Masthead>
          <Text role="entity" as="h1">Vehicle cohorts</Text>
          <Text role="body">
            {groups.length
              ? `Year, make, and model market records on Nuke, from ${groups.length} make${groups.length === 1 ? '' : 's'}.`
              : 'Year, make, and model market records on Nuke. Makes appear here when a year page is registered.'}
          </Text>
        </Masthead>
        {groups.length ? (
          <section className="k-section">
            <h2>Makes</h2>
            <ul>
              {groups.map((g) => {
                const n = g.models.reduce((sum, m) => sum + m.years.length, 0);
                return (
                  <li key={g.make.toLowerCase()}>
                    <Link to={cohortMakePath(g.make)}>{displayToken(g.make)}</Link>
                    {' · '}{n} year page{n === 1 ? '' : 's'}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : <p>No year pages are registered yet.</p>}
      </main>
    );
  }

  if (hub.kind === 'make') {
    const groups = groupProfiles(all.filter((r) => r.make.toLowerCase() === hub.make.toLowerCase()));
    const models = groups[0]?.models ?? [];
    const label = displayToken(hub.make);
    return (
      <main>
        <Masthead>
          <Text role="caption"><Link to="/cohort">Cohorts</Link></Text>
          <Text role="entity" as="h1">{label}</Text>
          <Text role="body">
            {models.length
              ? `${label} models on Nuke, ${models.length} model${models.length === 1 ? '' : 's'} with year pages.`
              : `${label} market records on Nuke. Models appear here when a year page is registered.`}
          </Text>
        </Masthead>
        {models.length ? (
          <section className="k-section">
            <h2>Models</h2>
            <ul>
              {models.map((m) => (
                <li key={m.model.toLowerCase()}>
                  <Link to={cohortModelPath(m.make, m.model)}>{displayToken(m.model)}</Link>
                  {' · '}{m.years.length} year page{m.years.length === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          </section>
        ) : <p>No year pages are registered for {label} yet.</p>}
      </main>
    );
  }

  const years = all
    .filter((r) => r.make.toLowerCase() === hub.make.toLowerCase() && r.model.toLowerCase() === hub.model.toLowerCase())
    .slice()
    .sort((a, b) => a.year - b.year);
  const label = `${displayToken(hub.make)} ${displayToken(hub.model)}`;
  return (
    <main>
      <Masthead>
        <Text role="caption"><Link to="/cohort">Cohorts</Link> · <Link to={cohortMakePath(hub.make)}>{displayToken(hub.make)}</Link></Text>
        <Text role="entity" as="h1">{label}</Text>
        <Text role="body">
          {years.length
            ? `${label} year pages on Nuke, ${years.length} year${years.length === 1 ? '' : 's'}.`
            : `${label} market records on Nuke. Year pages appear here when they are registered.`}
        </Text>
      </Masthead>
      {years.length ? (
        <section className="k-section">
          <h2>Years</h2>
          <ul>
            {years.map((y) => (
              <li key={y.year}>
                <Link to={cohortPath(y.make, y.model, y.year)}>{y.year}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : <p>No year pages are registered for {label} yet.</p>}
    </main>
  );
};

export default CohortHub;
