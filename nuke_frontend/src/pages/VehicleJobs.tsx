import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type LocationPreference = 'on_site' | 'drop_off' | 'either';
type JobStatus = 'draft' | 'listed' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
type FundingStatus = 'none' | 'requested' | 'held' | 'released' | 'failed';

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
}

interface VehicleJobRow {
  id: string;
  vehicle_id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  desired_completion_date: string | null;
  desired_start_date: string | null;
  estimated_hours: number | null;
  location_preference: LocationPreference;
  budget_cents: number | null;
  currency: string;
  allow_hold: boolean;
  funding_status: FundingStatus;
  status: JobStatus;
  visibility: 'private' | 'invited' | 'marketplace';
  metadata: Record<string, any>;
  created_at: string;
}

const formatMoney = (cents: number | null, currency = 'USD') => {
  if (typeof cents !== 'number') return '—';
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(dollars);
  } catch {
    return `$${Math.round(dollars)}`;
  }
};

const todayISODate = () => new Date().toISOString().slice(0, 10);

export default function VehicleJobs() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<any>(null);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<VehicleJobRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Quick capture
  const [quickText, setQuickText] = useState('');
  const [quickDefaultHold, setQuickDefaultHold] = useState(false);
  const [quickDefaultBudgetUsd, setQuickDefaultBudgetUsd] = useState<string>('');
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  // Full job form
  const [showFullForm, setShowFullForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [desiredCompletionDate, setDesiredCompletionDate] = useState('');
  const [desiredStartDate, setDesiredStartDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState<string>('');
  const [locationPreference, setLocationPreference] = useState<LocationPreference>('either');
  const [allowHold, setAllowHold] = useState(false);
  const [budgetUsd, setBudgetUsd] = useState<string>('');
  const [visibility, setVisibility] = useState<'private' | 'invited' | 'marketplace'>('private');
  const [submitting, setSubmitting] = useState(false);

  const vehicleLabel = useMemo(() => {
    if (!vehicle) return 'Vehicle';
    const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
    return ymm || vehicle.vin || 'Vehicle';
  }, [vehicle]);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session || null);
    };
    init();
  }, []);

  useEffect(() => {
    if (!vehicleId) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Load vehicle label for header only
        const { data: v, error: vErr } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin')
          .eq('id', vehicleId)
          .single();
        if (vErr) throw vErr;
        setVehicle(v as VehicleRow);

        // Load jobs
        const { data: j, error: jErr } = await supabase
          .from('vehicle_jobs')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('created_at', { ascending: false });
        if (jErr) throw jErr;
        setJobs((j as VehicleJobRow[]) || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load jobs');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [vehicleId]);

  const bestEffortCreateTimelineEvent = async (job: VehicleJobRow) => {
    try {
      // timeline_events schema varies across migrations; keep it minimal and flexible.
      await supabase.from('timeline_events').insert([
        {
          vehicle_id: job.vehicle_id,
          user_id: session?.user?.id || null,
          event_type: 'job_created',
          source: 'user_input',
          event_date: todayISODate(),
          title: `Job Created: ${job.title}`,
          description: job.description || null,
          metadata: {
            job_id: job.id,
            job: {
              title: job.title,
              desired_completion_date: job.desired_completion_date,
              desired_start_date: job.desired_start_date,
              estimated_hours: job.estimated_hours,
              location_preference: job.location_preference,
              budget_cents: job.budget_cents,
              currency: job.currency,
              allow_hold: job.allow_hold,
              funding_status: job.funding_status,
              status: job.status,
              visibility: job.visibility
            }
          }
        }
      ]);
    } catch {
      // Non-critical: timeline is best-effort for this MVP page.
    }
  };

  const createHoldIfNeeded = async (jobId: string, amountCents: number) => {
    if (!amountCents || amountCents <= 0) return;
    try {
      await supabase.from('vehicle_job_holds').insert([
        {
          job_id: jobId,
          created_by: session?.user?.id || null,
          amount_cents: amountCents,
          currency: 'USD',
          status: 'pending',
          metadata: {
            note: 'Hold created from VehicleJobs (MVP). Payment processor integration pending.'
          }
        }
      ]);
    } catch {
      // Best-effort; UI still indicates hold intent via job.funding_status.
    }
  };

  const dollarsToCents = (val: string): number | null => {
    if (!val) return null;
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n * 100);
  };

  const createJob = async (payload: Partial<VehicleJobRow> & { title: string }) => {
    if (!vehicleId) return;
    if (!session?.user?.id) {
      setError('Please sign in to create jobs.');
      return;
    }
    const { data, error: insErr } = await supabase
      .from('vehicle_jobs')
      .insert([
        {
          vehicle_id: vehicleId,
          created_by: session.user.id,
          title: payload.title,
          description: payload.description || null,
          desired_completion_date: payload.desired_completion_date || null,
          desired_start_date: payload.desired_start_date || null,
          estimated_hours: payload.estimated_hours ?? null,
          location_preference: payload.location_preference || 'either',
          budget_cents: payload.budget_cents ?? null,
          currency: payload.currency || 'USD',
          allow_hold: !!payload.allow_hold,
          funding_status: payload.funding_status || 'none',
          status: payload.status || 'draft',
          visibility: payload.visibility || 'private',
          metadata: payload.metadata || {}
        }
      ])
      .select('*')
      .single();
    if (insErr) throw insErr;
    return data as VehicleJobRow;
  };

  const onSubmitFull = async () => {
    if (!vehicleId) return;
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const budgetCents = dollarsToCents(budgetUsd);
      const fundingStatus: FundingStatus =
        allowHold && budgetCents ? 'requested' : 'none';

      const job = await createJob({
        title: title.trim(),
        description: description.trim() || null,
        desired_completion_date: desiredCompletionDate || null,
        desired_start_date: desiredStartDate || null,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
        location_preference: locationPreference,
        budget_cents: budgetCents,
        allow_hold: allowHold,
        funding_status: fundingStatus,
        visibility,
        status: 'listed',
        metadata: {
          created_via: 'vehicle_jobs_full_form'
        }
      });

      if (job) {
        if (allowHold && budgetCents) {
          await createHoldIfNeeded(job.id, budgetCents);
          await supabase
            .from('vehicle_jobs')
            .update({ funding_status: 'requested' })
            .eq('id', job.id);
          job.funding_status = 'requested';
        }

        setJobs(prev => [job, ...prev]);
        await bestEffortCreateTimelineEvent(job);

        // Reset form
        setTitle('');
        setDescription('');
        setDesiredCompletionDate('');
        setDesiredStartDate('');
        setEstimatedHours('');
        setLocationPreference('either');
        setAllowHold(false);
        setBudgetUsd('');
        setVisibility('private');
        setShowFullForm(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to create job');
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitQuick = async () => {
    if (!vehicleId) return;
    const lines = quickText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setQuickSubmitting(true);
    setError(null);
    try {
      const budgetCents = dollarsToCents(quickDefaultBudgetUsd);
      const fundingStatus: FundingStatus =
        quickDefaultHold && budgetCents ? 'requested' : 'none';

      // Create jobs sequentially to keep timeline events aligned and avoid rate spikes.
      const created: VehicleJobRow[] = [];
      for (const t of lines.slice(0, 25)) {
        const job = await createJob({
          title: t,
          description: null,
          desired_completion_date: null,
          desired_start_date: null,
          estimated_hours: null,
          location_preference: 'either',
          budget_cents: budgetCents,
          allow_hold: quickDefaultHold,
          funding_status: fundingStatus,
          visibility: 'private',
          status: 'draft',
          metadata: {
            created_via: 'vehicle_jobs_quick_capture'
          }
        });
        if (job) {
          if (quickDefaultHold && budgetCents) {
            await createHoldIfNeeded(job.id, budgetCents);
            await supabase
              .from('vehicle_jobs')
              .update({ funding_status: 'requested' })
              .eq('id', job.id);
            job.funding_status = 'requested';
          }
          created.push(job);
          await bestEffortCreateTimelineEvent(job);
        }
      }

      setJobs(prev => [...created, ...prev]);
      setQuickText('');
    } catch (e: any) {
      setError(e?.message || 'Failed to create jobs');
    } finally {
      setQuickSubmitting(false);
    }
  };

  const statusBadge = (job: VehicleJobRow) => {
    const label = job.status.toUpperCase();
    const color =
      job.status === 'completed'
        ? 'badge-success'
        : job.status === 'in_progress'
        ? 'badge-warning'
        : job.status === 'cancelled'
        ? 'badge-secondary'
        : 'badge-secondary';
    return <span className={`badge ${color}`}>{label}</span>;
  };

  const fundingBadge = (job: VehicleJobRow) => {
    if (!job.allow_hold) return null;
    const label = job.funding_status === 'requested' ? 'HOLD REQUESTED' : job.funding_status.toUpperCase();
    const color =
      job.funding_status === 'held'
        ? 'badge-success'
        : job.funding_status === 'requested'
        ? 'badge-warning'
        : job.funding_status === 'failed'
        ? 'badge-danger'
        : 'badge-secondary';
    return <span className={`badge ${color}`}>{label}</span>;
  };

  if (!vehicleId) {
    return (
      <div className="card">
        <div className="card-body">Missing vehicle id.</div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <section className="section">
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <div>
              <div className="text-small text-muted">Job Desk</div>
              <div className="text" style={{ fontWeight: 700 }}>{vehicleLabel}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Link to={`/vehicle/${vehicleId}`} className="button button-secondary" style={{ fontSize: '10pt' }}>
                Back to Vehicle
              </Link>
              <Link to={`/vehicle/${vehicleId}/mailbox`} className="button button-secondary" style={{ fontSize: '10pt' }}>
                Open Mailbox
              </Link>
            </div>
          </div>
          <div className="card-body">
            {error && (
              <div className="alert alert-error" style={{ marginBottom: '12px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="card" style={{ border: '1px solid var(--border)' }}>
                <div className="card-header">Quick capture (paste a list)</div>
                <div className="card-body">
                  <div className="text-small text-muted" style={{ marginBottom: '8px' }}>
                    Paste one job per line. This creates draft job listings you can refine later.
                  </div>
                  <textarea
                    className="input"
                    value={quickText}
                    onChange={(e) => setQuickText(e.target.value)}
                    placeholder={`Install rear side windows\nInstall seats\nClean interior`}
                    rows={5}
                    style={{ width: '100%' }}
                  />

                  <div style={{ display: 'flex', gap: '12px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={quickDefaultHold}
                        onChange={(e) => setQuickDefaultHold(e.target.checked)}
                      />
                      Enable funding hold signal
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="text-small text-muted">Default budget (USD):</span>
                      <input
                        className="input"
                        style={{ width: '120px' }}
                        value={quickDefaultBudgetUsd}
                        onChange={(e) => setQuickDefaultBudgetUsd(e.target.value)}
                        placeholder="1500"
                        inputMode="numeric"
                      />
                    </div>

                    <button
                      className="button button-primary"
                      onClick={onSubmitQuick}
                      disabled={quickSubmitting || !quickText.trim()}
                    >
                      {quickSubmitting ? 'Creating...' : 'Create Draft Jobs'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card" style={{ border: '1px solid var(--border)' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Create one job (structured)</span>
                  <button
                    className="button button-secondary"
                    onClick={() => setShowFullForm(v => !v)}
                    style={{ fontSize: '10pt' }}
                  >
                    {showFullForm ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showFullForm && (
                  <div className="card-body">
                    <div style={{ display: 'grid', gap: '10px' }}>
                      <div>
                        <div className="text-small text-muted">Title</div>
                        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Undercarriage patch work" />
                      </div>
                      <div>
                        <div className="text-small text-muted">Description</div>
                        <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What needs to be done, constraints, what 'done' means." />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <div className="text-small text-muted">Desired start date</div>
                          <input className="input" type="date" value={desiredStartDate} onChange={(e) => setDesiredStartDate(e.target.value)} />
                        </div>
                        <div>
                          <div className="text-small text-muted">Desired completion date</div>
                          <input className="input" type="date" value={desiredCompletionDate} onChange={(e) => setDesiredCompletionDate(e.target.value)} />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                        <div>
                          <div className="text-small text-muted">Estimated hours</div>
                          <input className="input" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="4" inputMode="decimal" />
                        </div>
                        <div>
                          <div className="text-small text-muted">Location preference</div>
                          <select className="input" value={locationPreference} onChange={(e) => setLocationPreference(e.target.value as LocationPreference)}>
                            <option value="either">Either</option>
                            <option value="on_site">On-site</option>
                            <option value="drop_off">Drop-off</option>
                          </select>
                        </div>
                        <div>
                          <div className="text-small text-muted">Visibility</div>
                          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as any)}>
                            <option value="private">Private</option>
                            <option value="invited">Invited</option>
                            <option value="marketplace">Marketplace</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                          <div className="text-small text-muted">Budget (USD)</div>
                          <input className="input" value={budgetUsd} onChange={(e) => setBudgetUsd(e.target.value)} placeholder="1500" inputMode="numeric" />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <label className="text-small" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px' }}>
                            <input type="checkbox" checked={allowHold} onChange={(e) => setAllowHold(e.target.checked)} />
                            Enable funding hold signal
                          </label>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="button button-primary" onClick={onSubmitFull} disabled={submitting || !title.trim()}>
                          {submitting ? 'Creating...' : 'Create Job Listing'}
                        </button>
                        <button className="button button-secondary" onClick={() => setShowFullForm(false)} disabled={submitting}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="card" style={{ border: '1px solid var(--border)' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Jobs</span>
                  <span className="text-small text-muted">{jobs.length} total</span>
                </div>
                <div className="card-body">
                  {loading ? (
                    <div className="text-small text-muted">Loading jobs...</div>
                  ) : jobs.length === 0 ? (
                    <div className="text-small text-muted">No jobs yet. Add a quick list above.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {jobs.map(job => (
                        <div
                          key={job.id}
                          style={{
                            border: '1px solid var(--border)',
                            padding: '10px',
                            background: 'var(--white)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: '12px'
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <div className="text" style={{ fontWeight: 700 }}>{job.title}</div>
                              {statusBadge(job)}
                              {fundingBadge(job)}
                            </div>
                            <div className="text-small text-muted" style={{ marginTop: '4px' }}>
                              Budget: {formatMoney(job.budget_cents, job.currency)} · Location: {job.location_preference.replace('_', '-')} · Visibility: {job.visibility}
                            </div>
                            {job.desired_completion_date && (
                              <div className="text-small text-muted">
                                Desired completion: {job.desired_completion_date}
                              </div>
                            )}
                            {job.description && (
                              <div className="text-small" style={{ marginTop: '6px', whiteSpace: 'pre-wrap' }}>
                                {job.description}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                            <button
                              className="button button-secondary"
                              style={{ fontSize: '10pt' }}
                              onClick={() => navigate(`/vehicle/${vehicleId}/mailbox`)}
                            >
                              Discuss in Mailbox
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


