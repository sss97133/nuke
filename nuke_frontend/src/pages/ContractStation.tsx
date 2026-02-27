import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ContractBuilder from '../components/contract/ContractBuilder';
import ContractMarketplace from '../components/contract/ContractMarketplace';
import ContractTransparency from '../components/contract/ContractTransparency';

type TabType = 'marketplace' | 'builder' | 'my_contracts';

export default function ContractStation() {
  const { contractId: urlContractId } = useParams<{ contractId?: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('marketplace');
  const [selectedContractId, setSelectedContractId] = useState<string | null>(urlContractId || null);
  const [user, setUser] = useState<any>(null);

  // Sync state when URL param changes (e.g. direct navigation)
  useEffect(() => {
    setSelectedContractId(urlContractId || null);
  }, [urlContractId]);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 900, marginBottom: '8px' }}>
            Contract Station
          </h1>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Create and manage transparent investment contracts. Curate vehicles, organizations, projects, and users into investment packages.
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid var(--border)', marginBottom: '24px' }}>
            <button
              onClick={() => { setActiveTab('marketplace'); setSelectedContractId(null); navigate('/market/contracts', { replace: true }); }}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom: activeTab === 'marketplace' ? '2px solid var(--primary)' : '2px solid transparent',
                background: 'transparent',
                color: activeTab === 'marketplace' ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'marketplace' ? 700 : 400,
                fontSize: '12px',
                cursor: 'pointer',
                marginBottom: '-2px'
              }}
            >
              MARKETPLACE
            </button>
            <button
              onClick={() => { setActiveTab('builder'); setSelectedContractId(null); navigate('/market/contracts', { replace: true }); }}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom: activeTab === 'builder' ? '2px solid var(--primary)' : '2px solid transparent',
                background: 'transparent',
                color: activeTab === 'builder' ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: activeTab === 'builder' ? 700 : 400,
                fontSize: '12px',
                cursor: 'pointer',
                marginBottom: '-2px'
              }}
            >
              CREATE CONTRACT
            </button>
            {user && (
              <button
                onClick={() => { setActiveTab('my_contracts'); setSelectedContractId(null); navigate('/market/contracts', { replace: true }); }}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderBottom: activeTab === 'my_contracts' ? '2px solid var(--primary)' : '2px solid transparent',
                  background: 'transparent',
                  color: activeTab === 'my_contracts' ? 'var(--primary)' : 'var(--text-muted)',
                  fontWeight: activeTab === 'my_contracts' ? 700 : 400,
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginBottom: '-2px'
                }}
              >
                MY CONTRACTS
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {selectedContractId ? (
          <ContractTransparency
            contractId={selectedContractId}
            onBack={() => { setSelectedContractId(null); navigate('/market/contracts', { replace: true }); }}
          />
        ) : (
          <>
            {activeTab === 'marketplace' && (
              <ContractMarketplace
                onSelectContract={(id) => { setSelectedContractId(id); navigate(`/market/contracts/${id}`); }}
              />
            )}
            {activeTab === 'builder' && (
              <ContractBuilder
                onContractCreated={(id) => {
                  setSelectedContractId(id);
                  setActiveTab('marketplace');
                  navigate(`/market/contracts/${id}`);
                }}
              />
            )}
            {activeTab === 'my_contracts' && user && (
              <ContractMarketplace
                curatorId={user.id}
                onSelectContract={(id) => { setSelectedContractId(id); navigate(`/market/contracts/${id}`); }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

