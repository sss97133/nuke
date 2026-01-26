/**
 * Trading Page
 *
 * Wrapper for TradingTerminal component.
 * Route: /trading/:offeringId
 */

import { useParams, useNavigate } from 'react-router-dom';
import TradingTerminal from '../components/trading/TradingTerminal';

export default function TradingPage() {
  const { offeringId } = useParams<{ offeringId: string }>();
  const navigate = useNavigate();

  // If no offering ID, show selection prompt
  if (!offeringId) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', paddingTop: '100px' }}>
          <h1 style={{ fontSize: '14pt', marginBottom: '12px' }}>Trading Terminal</h1>
          <p style={{ fontSize: '10pt', color: 'var(--text-muted)', marginBottom: '24px' }}>
            Select an offering from the market to start trading.
          </p>
          <button
            className="button button-primary"
            onClick={() => navigate('/market/exchange')}
          >
            Browse Market
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f' }}>
      <TradingTerminal
        offeringId={offeringId}
        onClose={() => navigate('/market')}
      />
    </div>
  );
}
