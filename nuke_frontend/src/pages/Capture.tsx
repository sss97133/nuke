import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { UniversalImageUpload } from '../components/UniversalImageUpload';

const Capture: React.FC = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);

      if (!data.session) {
        navigate('/login');
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        <div className="text text-muted">Loading…</div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div style={{ padding: 12 }}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Add</span>
          <button className="button button-secondary" style={{ fontSize: '9pt' }} onClick={() => navigate('/')}
          >
            Done
          </button>
        </div>
        <div className="card-body" style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
          Drop photos here. If the system can’t place them confidently, they’ll stay in your inbox/album until you decide.
        </div>
      </div>

      <UniversalImageUpload onClose={() => navigate('/')} session={session} />
    </div>
  );
};

export default Capture;
