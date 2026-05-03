/**
 * SubjectProfile.tsx
 *
 * Generic dossier renderer that switches on subject kind.
 *
 * Route shape: /subject/:kind/:id where kind ∈
 *   {vehicle, part, tool, person, organization}
 *
 * - kind=vehicle      → redirects to canonical /vehicle/:id (VehicleProfile.tsx
 *                       remains the convergence point — see
 *                       docs/library/technical/design-book/vehicle-profile-computation-surface.md)
 * - kind=part         → reads parts_catalog
 * - kind=tool         → reads tool_catalog if present, else "first sighting" card
 * - kind=person       → reads profiles, then discovered_persons as fallback
 * - kind=organization → reads organizations
 *
 * Sparse subjects render an empty-state-as-onboarding card rather than erroring.
 *
 * NOT registered in App.tsx yet — that is a separate wiring step.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../styles/unified-design-system.css';

type SubjectKind = 'vehicle' | 'part' | 'tool' | 'person' | 'organization';

const VALID_KINDS: ReadonlyArray<SubjectKind> = [
  'vehicle',
  'part',
  'tool',
  'person',
  'organization',
];

interface FetchState<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
  /** Source table the row was eventually resolved from (debug + display). */
  source: string | null;
}

const initialState = <T,>(): FetchState<T> => ({
  loading: true,
  error: null,
  data: null,
  source: null,
});

/* ---------- shared layout primitives --------------------------------- */

const PageShell: React.FC<{
  kindLabel: string;
  id: string;
  children: React.ReactNode;
}> = ({ kindLabel, id, children }) => (
  <div
    style={{
      fontFamily: 'Arial, sans-serif',
      padding: '24px 12px',
      maxWidth: 960,
      margin: '0 auto',
    }}
  >
    <div
      style={{
        fontSize: 8,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--muted, #666)',
        marginBottom: 8,
      }}
    >
      SUBJECT / {kindLabel} / {id}
    </div>
    {children}
  </div>
);

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border, #ddd)' }}>
      <div
        style={{
          flex: '0 0 140px',
          fontSize: 8,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted, #666)',
          paddingTop: 2,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, fontSize: 13 }}>{value}</div>
    </div>
  );
};

const FirstSightingCard: React.FC<{
  kindLabel: string;
  id: string;
  hint?: string;
}> = ({ kindLabel, id, hint }) => (
  <div className="card">
    <div className="card-header">FIRST SIGHTING</div>
    <div className="card-body" style={{ fontSize: 13, lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        No record exists for {kindLabel.toLowerCase()} <code>{id}</code> yet.
      </div>
      <div style={{ marginBottom: 12, color: 'var(--muted, #666)' }}>
        {hint ??
          `This subject is emergent. The first observation that resolves to this id will populate the dossier.`}
      </div>
      <div
        style={{
          fontSize: 8,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted, #666)',
        }}
      >
        AWAITING FIRST OBSERVATION
      </div>
    </div>
  </div>
);

const LoadingShell: React.FC<{ kindLabel: string; id: string }> = ({
  kindLabel,
  id,
}) => (
  <PageShell kindLabel={kindLabel} id={id}>
    <div className="card">
      <div className="card-body" style={{ fontSize: 11, color: 'var(--muted, #666)' }}>
        LOADING...
      </div>
    </div>
  </PageShell>
);

const ErrorShell: React.FC<{ kindLabel: string; id: string; message: string }> = ({
  kindLabel,
  id,
  message,
}) => (
  <PageShell kindLabel={kindLabel} id={id}>
    <div className="card">
      <div className="card-header">SUBJECT UNAVAILABLE</div>
      <div className="card-body" style={{ fontSize: 13 }}>
        {message}
      </div>
    </div>
  </PageShell>
);

/* ---------- per-kind renderers --------------------------------------- */

const PartProfile: React.FC<{ id: string }> = ({ id }) => {
  const [state, setState] = useState<FetchState<any>>(initialState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('parts_catalog')
        .select(
          'id,name,description,brand,part_number,oem_part_number,aftermarket_part_numbers,category,compatible_makes,compatible_models,compatible_years,specifications,image_url,verified,data_source,average_price,price_updated_at',
        )
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState({ loading: false, error: error.message, data: null, source: null });
        return;
      }
      setState({ loading: false, error: null, data, source: 'parts_catalog' });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.loading) return <LoadingShell kindLabel="PART" id={id} />;
  if (state.error)
    return <ErrorShell kindLabel="PART" id={id} message={state.error} />;
  if (!state.data) {
    return (
      <PageShell kindLabel="PART" id={id}>
        <FirstSightingCard
          kindLabel="Part"
          id={id}
          hint="Catalog this part by ingesting an MPN, OEM number, or supplier listing."
        />
      </PageShell>
    );
  }

  const p = state.data;
  const fitment =
    (p.compatible_years?.length ||
      p.compatible_makes?.length ||
      p.compatible_models?.length) ?
      [
        p.compatible_years?.length ? `${p.compatible_years.join(', ')}` : null,
        p.compatible_makes?.length ? p.compatible_makes.join(', ') : null,
        p.compatible_models?.length ? p.compatible_models.join(', ') : null,
      ]
        .filter(Boolean)
        .join(' / ')
    : null;

  return (
    <PageShell kindLabel="PART" id={id}>
      <div className="card">
        <div className="card-header">{p.name || 'UNNAMED PART'}</div>
        <div className="card-body">
          <Field label="MANUFACTURER" value={p.brand} />
          <Field label="MPN" value={p.part_number} />
          <Field label="OEM" value={p.oem_part_number} />
          <Field
            label="AFTERMARKET"
            value={p.aftermarket_part_numbers?.length ? p.aftermarket_part_numbers.join(', ') : null}
          />
          <Field label="CATEGORY" value={p.category} />
          <Field label="FITMENT" value={fitment} />
          <Field label="DESCRIPTION" value={p.description} />
          <Field label="VERIFIED" value={p.verified ? 'YES' : null} />
          <Field label="DATA SOURCE" value={p.data_source} />
          <Field
            label="AVG PRICE"
            value={p.average_price != null ? `$${Number(p.average_price).toLocaleString()}` : null}
          />
        </div>
      </div>
    </PageShell>
  );
};

const ToolProfile: React.FC<{ id: string }> = ({ id }) => {
  const [state, setState] = useState<FetchState<any>>(initialState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Best-effort: tool_catalog exists per schema check 2026-04-26.
      const { data, error } = await supabase
        .from('tool_catalog')
        .select(
          'id,name,description,long_description,part_number,model_number,sku,specifications,msrp,product_url,brochure_image_url,is_active,is_discontinued,subcategory',
        )
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Table may not exist on some envs — degrade gracefully.
        setState({ loading: false, error: null, data: null, source: null });
        return;
      }
      setState({ loading: false, error: null, data, source: 'tool_catalog' });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.loading) return <LoadingShell kindLabel="TOOL" id={id} />;
  if (!state.data) {
    return (
      <PageShell kindLabel="TOOL" id={id}>
        <FirstSightingCard
          kindLabel="Tool"
          id={id}
          hint="No tool record yet. Tools become subjects when an observation references them — e.g. a tool receipt, an inventory scan, or a usage event."
        />
      </PageShell>
    );
  }

  const t = state.data;
  return (
    <PageShell kindLabel="TOOL" id={id}>
      <div className="card">
        <div className="card-header">{t.name || 'UNNAMED TOOL'}</div>
        <div className="card-body">
          <Field label="SUBCATEGORY" value={t.subcategory} />
          <Field label="MODEL" value={t.model_number} />
          <Field label="MPN" value={t.part_number} />
          <Field label="SKU" value={t.sku} />
          <Field label="DESCRIPTION" value={t.description || t.long_description} />
          <Field label="MSRP" value={t.msrp != null ? `$${Number(t.msrp).toLocaleString()}` : null} />
          <Field
            label="STATUS"
            value={t.is_discontinued ? 'DISCONTINUED' : t.is_active ? 'ACTIVE' : null}
          />
          <Field
            label="PRODUCT URL"
            value={
              t.product_url ? (
                <a href={t.product_url} target="_blank" rel="noreferrer">
                  {t.product_url}
                </a>
              ) : null
            }
          />
        </div>
      </div>
    </PageShell>
  );
};

const PersonProfile: React.FC<{ id: string }> = ({ id }) => {
  const [state, setState] = useState<FetchState<any>>(initialState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Tier 1: claimed `profiles` row.
      const profileRes = await supabase
        .from('profiles')
        .select(
          'id,full_name,username,avatar_url,bio,location,website,user_type,verification_level,is_verified,is_public',
        )
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (profileRes.data) {
        setState({
          loading: false,
          error: null,
          data: profileRes.data,
          source: 'profiles',
        });
        return;
      }

      // Tier 2: emergent / unclaimed `discovered_persons`.
      const discRes = await supabase
        .from('discovered_persons')
        .select(
          'id,slug,full_name,bio,avatar_url,primary_role,location,known_for,expertise_areas,confidence_score,enrichment_status',
        )
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (discRes.data) {
        setState({
          loading: false,
          error: null,
          data: discRes.data,
          source: 'discovered_persons',
        });
        return;
      }

      setState({ loading: false, error: null, data: null, source: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.loading) return <LoadingShell kindLabel="PERSON" id={id} />;
  if (!state.data) {
    return (
      <PageShell kindLabel="PERSON" id={id}>
        <FirstSightingCard
          kindLabel="Person"
          id={id}
          hint="No claimed profile or emergent person record. The first observation that mentions this person will create the dossier."
        />
      </PageShell>
    );
  }

  const p = state.data;
  const isClaimed = state.source === 'profiles';
  return (
    <PageShell kindLabel="PERSON" id={id}>
      <div className="card">
        <div className="card-header">
          {p.full_name || p.username || p.slug || 'UNNAMED PERSON'}
        </div>
        <div className="card-body">
          <Field
            label="STATUS"
            value={isClaimed ? 'CLAIMED PROFILE' : 'EMERGENT (UNCLAIMED)'}
          />
          {isClaimed ? (
            <>
              <Field label="USERNAME" value={p.username} />
              <Field label="USER TYPE" value={p.user_type} />
              <Field label="VERIFIED" value={p.is_verified ? 'YES' : null} />
              <Field label="VERIFICATION LEVEL" value={p.verification_level} />
              <Field label="LOCATION" value={p.location} />
              <Field label="BIO" value={p.bio} />
              <Field
                label="WEBSITE"
                value={
                  p.website ? (
                    <a href={p.website} target="_blank" rel="noreferrer">
                      {p.website}
                    </a>
                  ) : null
                }
              />
            </>
          ) : (
            <>
              <Field label="ROLE" value={p.primary_role} />
              <Field label="LOCATION" value={p.location} />
              <Field label="BIO" value={p.bio} />
              <Field
                label="KNOWN FOR"
                value={p.known_for?.length ? p.known_for.join(', ') : null}
              />
              <Field
                label="EXPERTISE"
                value={p.expertise_areas?.length ? p.expertise_areas.join(', ') : null}
              />
              <Field
                label="CONFIDENCE"
                value={p.confidence_score != null ? `${p.confidence_score}` : null}
              />
              <Field label="ENRICHMENT" value={p.enrichment_status} />
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
};

const OrganizationDossier: React.FC<{ id: string }> = ({ id }) => {
  const [state, setState] = useState<FetchState<any>>(initialState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select(
          'id,business_name,legal_name,business_type,industry_focus,description,website,phone,email,address,city,state,zip_code,country,specializations,services_offered,years_in_business,employee_count',
        )
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setState({ loading: false, error: error.message, data: null, source: null });
        return;
      }
      setState({ loading: false, error: null, data, source: 'organizations' });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.loading) return <LoadingShell kindLabel="ORGANIZATION" id={id} />;
  if (state.error)
    return <ErrorShell kindLabel="ORGANIZATION" id={id} message={state.error} />;
  if (!state.data) {
    return (
      <PageShell kindLabel="ORGANIZATION" id={id}>
        <FirstSightingCard
          kindLabel="Organization"
          id={id}
          hint="No organization record. The canonical OrganizationProfile lives at /organization/:id — this generic view exists for emergent or unresolved org ids."
        />
      </PageShell>
    );
  }

  const o = state.data;
  const location = [o.city, o.state, o.zip_code, o.country].filter(Boolean).join(', ');

  return (
    <PageShell kindLabel="ORGANIZATION" id={id}>
      <div className="card">
        <div className="card-header">{o.business_name || o.legal_name || 'UNNAMED ORG'}</div>
        <div className="card-body">
          <Field label="LEGAL NAME" value={o.legal_name} />
          <Field label="TYPE" value={o.business_type} />
          <Field
            label="INDUSTRY"
            value={o.industry_focus?.length ? o.industry_focus.join(', ') : null}
          />
          <Field
            label="SPECIALIZATIONS"
            value={o.specializations?.length ? o.specializations.join(', ') : null}
          />
          <Field
            label="SERVICES"
            value={o.services_offered?.length ? o.services_offered.join(', ') : null}
          />
          <Field label="LOCATION" value={location || null} />
          <Field label="ADDRESS" value={o.address} />
          <Field label="PHONE" value={o.phone} />
          <Field label="EMAIL" value={o.email} />
          <Field
            label="WEBSITE"
            value={
              o.website ? (
                <a href={o.website} target="_blank" rel="noreferrer">
                  {o.website}
                </a>
              ) : null
            }
          />
          <Field
            label="YEARS IN BUSINESS"
            value={o.years_in_business != null ? String(o.years_in_business) : null}
          />
          <Field
            label="EMPLOYEES"
            value={o.employee_count != null ? String(o.employee_count) : null}
          />
          <Field label="DESCRIPTION" value={o.description} />
          <div style={{ marginTop: 12 }}>
            <Link
              to={`/organization/${id}`}
              style={{
                fontSize: 8,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              VIEW CANONICAL ORGANIZATION PROFILE →
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

/* ---------- top-level switch ----------------------------------------- */

const SubjectProfile: React.FC = () => {
  const { kind, id } = useParams<{ kind: string; id: string }>();

  if (!kind || !id) {
    return (
      <ErrorShell
        kindLabel="UNKNOWN"
        id={id || '?'}
        message="Route requires both :kind and :id params (e.g. /subject/part/<uuid>)."
      />
    );
  }

  if (!VALID_KINDS.includes(kind as SubjectKind)) {
    return (
      <ErrorShell
        kindLabel={kind.toUpperCase()}
        id={id}
        message={`Unknown subject kind "${kind}". Valid kinds: ${VALID_KINDS.join(', ')}.`}
      />
    );
  }

  // Vehicle: delegate to canonical convergence point.
  // VehicleProfile.tsx is the ONLY display layer for vehicles
  // (docs/library/technical/design-book/vehicle-profile-computation-surface.md rule #8).
  if (kind === 'vehicle') {
    return <Navigate to={`/vehicle/${id}`} replace />;
  }

  switch (kind as SubjectKind) {
    case 'part':
      return <PartProfile id={id} />;
    case 'tool':
      return <ToolProfile id={id} />;
    case 'person':
      return <PersonProfile id={id} />;
    case 'organization':
      return <OrganizationDossier id={id} />;
    default:
      return (
        <ErrorShell
          kindLabel={kind.toUpperCase()}
          id={id}
          message="Unhandled subject kind."
        />
      );
  }
};

export default SubjectProfile;
