import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface MembershipContext {
  can_review: boolean;
  membership_id: string | null;
  status: string | null;
  role: string | null;
}
interface Membership {
  id: string;
  user_id: string;
  status: string;
  end_date: string | null;
}

function AccountMembership({ organizationId }: { organizationId: string }) {
  const navigate = useNavigate();
  const [context, setContext] = useState<MembershipContext | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = useRef(false);
  const signing = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError('');
      try {
        const { data, error: readError } = await supabase.rpc('accounting_membership_context', { p_organization_id: organizationId });
        if (cancelled) return;
        if (readError || !data || typeof data.can_review !== 'boolean') throw new Error('context');
        setContext(data as MembershipContext);
        if (data.can_review) {
          const { data: rows, error: rowsError } = await supabase.from('organization_contributors')
            .select('id,user_id,status,end_date').eq('organization_id', organizationId)
            .eq('role', 'accountant').in('status', ['pending', 'active', 'inactive'])
            .order('created_at', { ascending: false }).limit(100);
          if (cancelled) return;
          if (rowsError) throw new Error('members');
          setMembers(rows ?? []);
        } else setMembers([]);
      } catch {
        if (!cancelled) { setContext(null); setMembers([]); setError('Accounting membership could not be loaded. Try refreshing this section.'); }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [organizationId, revision]);

  async function sign(action: 'request' | 'approve' | 'revoke', membershipId?: string) {
    if (signing.current) return;
    signing.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const { error: writeError } = action === 'request'
        ? await supabase.rpc('request_accounting_membership', { p_organization_id: organizationId })
        : await supabase.rpc('review_accounting_membership', { p_membership_id: membershipId, p_action: action });
      if (!active.current) return;
      if (writeError) throw new Error('membership');
      setMessage(action === 'request' ? 'Accounting membership requested. An organization owner must approve it.'
        : action === 'approve' ? 'Accounting membership approved.' : 'Accounting membership revoked.');
      setRevision(value => value + 1);
    } catch {
      if (active.current) setError('The membership change was not confirmed. Refresh to check its status; only an authorized organization owner can approve or revoke access.');
    } finally {
      signing.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {!context && !error ? <p role="status">Checking membership…</p> : null}
      {context ? <>
        <p>Your role: {context.role === 'accountant' ? 'Accounting' : context.role ?? 'No membership'}{context.status ? ` · ${context.status}` : ''}</p>
        {!context.membership_id ? <button type="button" className="btn-base btn-md btn-primary" disabled={pending} onClick={() => sign('request')}>Request Accounting membership</button> : null}
        {context.status === 'pending' ? <p>Membership is pending owner approval. Pending requests do not grant accounting access.</p> : null}
        {context.status === 'inactive' ? <p>Membership is inactive. An organization owner must approve it again before access resumes.</p> : null}
        {context.status === 'active' && (context.role === 'accountant' || context.can_review) ?
          <section aria-labelledby="accounting-agent-heading">
            <h4 id="accounting-agent-heading">Connect your terminal agent</h4>
            <p>In Claude Code’s terminal, add Nuke once, then sign in through your browser:</p>
            <pre style={{ overflowX: 'auto' }}>{'claude mcp add --transport http --scope user nuke https://nuke.ag/mcp\nclaude mcp login nuke'}</pre>
            <p>If Nuke is already configured, run only the login command. You can also open /mcp inside Claude Code and select Nuke to authenticate.</p>
            <button type="button" className="btn-base btn-md" onClick={() => navigate('/settings/api-keys')}>Manage my account’s API keys</button>
          </section> : null}
        {context.can_review ? <section aria-labelledby="accounting-members-heading">
          <h4 id="accounting-members-heading">Accounting members and requests</h4>
          <p>Share this organization’s Contributors page with a colleague. They sign in with their own account and request Accounting membership here.</p>
          {members.length ? <ul style={{ paddingLeft: 20 }}>{members.map(member => <li key={member.id} style={{ marginBottom: 12, overflowWrap: 'anywhere' }}>
            <span>Account {member.user_id} · {member.status}{member.end_date ? ` · ended ${member.end_date}` : ''}</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <button type="button" className="btn-base btn-sm" onClick={() => navigate(`/profile/${member.user_id}`)}>View account</button>
              {member.status === 'pending' || member.status === 'inactive' ? <button type="button" className="btn-base btn-sm btn-primary" disabled={pending} onClick={() => sign('approve', member.id)}>Approve Accounting role</button> : null}
              {!member.end_date ? <button type="button" className="btn-base btn-sm" disabled={pending} onClick={() => sign('revoke', member.id)}>Revoke Accounting membership</button> : null}
            </div>
          </li>)}</ul> : <p>No Accounting memberships or requests.</p>}
          {members.length === 100 ? <p>Showing the 100 most recent memberships.</p> : null}
        </section> : null}
      </> : null}
      <button type="button" className="btn-base btn-sm" disabled={pending} onClick={() => setRevision(value => value + 1)}>Refresh membership</button>
    </>
  );
}

export default function OrganizationAccountingMembership({ organizationId }: { organizationId: string }) {
  const { user, loading } = useAuthContext();
  const navigate = useNavigate();
  const returnUrl = `/org/${encodeURIComponent(organizationId)}?tab=contributors`;
  return <section style={{ borderBottom: '2px solid var(--border)', paddingBottom: 16, marginBottom: 16 }} aria-labelledby="accounting-membership-heading">
    <h3 id="accounting-membership-heading">Accounting membership</h3>
    <p>Accounting access belongs to your organization membership. Authorize your agent through your own account; its access follows your approved role. Receipt submissions retain your contribution on behalf of the account owner. Interpretations require review before expense posting.</p>
    {loading ? <p role="status">Checking your account…</p> : user ?
      <AccountMembership key={`${user.id}:${organizationId}`} organizationId={organizationId} /> :
      <button type="button" className="btn-base btn-md btn-primary" onClick={() => navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`)}>Sign in to request membership</button>}
  </section>;
}
