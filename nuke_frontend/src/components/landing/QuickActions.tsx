import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const QuickActions: React.FC = () => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QuickActions.tsx:7',message:'QuickActions component start',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run16',hypothesisId:'T'})}).catch(()=>{});
  // #endregion
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QuickActions.tsx:10',message:'Before useNavigate call',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run16',hypothesisId:'T'})}).catch(()=>{});
  // #endregion
  const navigate = useNavigate();
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QuickActions.tsx:13',message:'After useNavigate call',data:{hasNavigate:typeof navigate === 'function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run16',hypothesisId:'T'})}).catch(()=>{});
  // #endregion
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    };
    
    checkAuth();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QuickActions.tsx:27',message:'Before actions array creation',data:{hasNavigate:typeof navigate === 'function',isAuthenticated},timestamp:Date.now(),sessionId:'debug-session',runId:'run16',hypothesisId:'T'})}).catch(()=>{});
  // #endregion
  
  // Create actions inline in render to avoid TDZ - navigate is guaranteed to be initialized by this point
  // Store only paths, not closures, to completely avoid TDZ
  const baseActions = [
    {
      title: 'Browse Marketplace',
      path: '/all-vehicles?forSale=true',
      primary: false
    },
    {
      title: 'Explore Community',
      path: '/all-vehicles',
      primary: false
    },
    {
      title: 'Browse Professionals',
      path: '/browse-professionals',
      primary: false
    }
  ];

  const authActions = !isAuthenticated ? [{
    title: 'Join Community',
    path: '/auth',
    primary: false
  }] : [];

  const allActions = [...baseActions, ...authActions];
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QuickActions.tsx:55',message:'After actions array creation',data:{actionsCount:allActions.length,hasNavigate:typeof navigate === 'function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run16',hypothesisId:'T'})}).catch(()=>{});
  // #endregion

  return (
    <section className="section">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {allActions.map((action, index) => (
          <button
            key={index}
            onClick={() => navigate(action.path)}
            className={`card hover:shadow-md transition-shadow text-left ${
              action.primary ? 'ring-2 ring-blue-500' : ''
            }`}
          >
            <div>
              <h3 className="text-xs font-medium text-black mb-1">{action.title}</h3>
            </div>
            {action.primary && (
              <div className="mt-3">
                <span className="badge badge-primary">Recommended</span>
              </div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
};

export default QuickActions;
