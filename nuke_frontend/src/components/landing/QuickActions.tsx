import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const QuickActions: React.FC = () => {
  const navigate = useNavigate();
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

  const actions = [
    {
      title: 'Browse Marketplace',
      action: () => navigate('/all-vehicles?forSale=true'),
      primary: false
    },
    {
      title: 'Explore Community',
      action: () => navigate('/all-vehicles'),
      primary: false
    },
    {
      title: 'Browse Professionals',
      action: () => navigate('/browse-professionals'),
      primary: false
    },
    ...(!isAuthenticated ? [{
      title: 'Join Community',
      action: () => navigate('/login'),
      primary: false
    }] : [])
  ];

  return (
    <section className="section">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={action.action}
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
