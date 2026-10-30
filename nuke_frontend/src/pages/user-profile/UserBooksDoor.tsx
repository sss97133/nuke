/**
 * UserBooksDoor: the owner's door from the profile to the accounting office.
 *
 * One kit block, one row per tax year (the stored gate's verdict, when it ran and the return items still open), and one link to the
 * Books docket at /accounting. Owner-only: a visitor gets no heading, no row and no request; the database refuses anyone but the owner
 * as well (books_gate_status raises 42501), so this component is a convenience, not the gate. The profile itself stays public.
 * Reads only the stored gate status (about 1 s, summed from its parts on prod, read-only, 2026-10-29); it never runs the gate and is handed none of the books' rows.
 */
import React from 'react';
import { Row, Rows, Section, Text } from '../../kit';
import PrefetchLink from '../../components/PrefetchLink';
import { ReadState } from '../../components/finance/CloseItem';
import { useRevisionRead } from '../../components/finance/useRevisionRead';
import { doorLine } from '../../components/finance/booksDocketWords';
import { readGateStatus } from '../../services/accountingCloseout';

function Door({ userId }: { userId: string }) {
  const gate = useRevisionRead('gate', signal => readGateStatus(userId, signal), { scope: userId, enabled: true });
  if (gate.phase === 'idle' || gate.phase === 'loading') return null;
  const link = <PrefetchLink to="/accounting"><Text role="body">Open the books docket ›</Text></PrefetchLink>;
  if (gate.phase === 'error' || !gate.data) {
    return <Section title="Books" coverage={{ n: 0, of: 0, grain: 'tax years read (the read failed)', as_of: null }}>
      <ReadState what="The books status" failed onRetry={gate.retry} />
      {link}
    </Section>;
  }
  const { summary, years } = gate.data;
  return <Section title="Books" coverage={{ n: summary.with_run, of: summary.years, grain: 'tax years with a stored gate run', as_of: gate.data.read_at }}>
    <Rows title="Tax years">
      {years.map(y => <Row key={y.year} label={String(y.year)}>{doorLine(y)}</Row>)}
    </Rows>
    {link}
  </Section>;
}

const UserBooksDoor: React.FC<{ userId: string; isOwnProfile: boolean }> = ({ userId, isOwnProfile }) => {
  // The owner's session only. For anyone else nothing renders and nothing is requested.
  if (!isOwnProfile || !userId) return null;
  return <Door userId={userId} />;
};

export default UserBooksDoor;
