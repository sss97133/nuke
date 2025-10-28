/**
 * Mobile Organization Switcher
 * Dropdown to switch between orgs for users with multiple affiliations
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface MobileOrgSwitcherProps {
  session: any;
  onOrgSelect?: (orgId: string) => void;
}

export const MobileOrgSwitcher: React.FC<MobileOrgSwitcherProps> = ({ session, onOrgSelect }) => {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    if (session?.user) {
      loadUserOrgs();
    }
  }, [session]);

  const loadUserOrgs = async () => {
    if (!session?.user?.id) return;

    // Get all shops where user is a member or owner
    const { data: memberships } = await supabase
      .from('shop_members')
      .select(`
        shop_id,
        role,
        shops:shop_id (
          id,
          name,
          business_type,
          logo_url,
          status,
          is_verified
        )
      `)
      .eq('user_id', session.user.id)
      .eq('status', 'active');

    // Get shops owned by user
    const { data: ownedShops } = await supabase
      .from('shops')
      .select('id, name, business_type, logo_url, status, is_verified')
      .eq('owner_user_id', session.user.id);

    // Combine and deduplicate
    const allOrgs = [
      ...(memberships?.map(m => ({ ...m.shops, role: m.role })) || []),
      ...(ownedShops?.map(s => ({ ...s, role: 'owner' })) || [])
    ];

    // Deduplicate by id
    const uniqueOrgs = allOrgs.filter((org, index, self) =>
      index === self.findIndex((o) => o.id === org.id)
    );

    setOrgs(uniqueOrgs);

    // Auto-select first org
    if (uniqueOrgs.length > 0 && !selectedOrg) {
      setSelectedOrg(uniqueOrgs[0].id);
      onOrgSelect?.(uniqueOrgs[0].id);
    }
  };

  const handleOrgChange = (orgId: string) => {
    setSelectedOrg(orgId);
    setShowDropdown(false);
    onOrgSelect?.(orgId);
  };

  if (!session?.user || orgs.length === 0) return null;

  const currentOrg = orgs.find(o => o.id === selectedOrg);

  return (
    <div style={styles.container}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={styles.button}
      >
        <div style={styles.buttonContent}>
          {currentOrg?.logo_url && (
            <img src={currentOrg.logo_url} alt="" style={styles.logo} />
          )}
          <div style={styles.orgInfo}>
            <div style={styles.orgName}>{currentOrg?.name || 'Select Org'}</div>
            <div style={styles.orgRole}>{currentOrg?.role}</div>
          </div>
          <span style={styles.arrow}>{showDropdown ? '▲' : '▼'}</span>
        </div>
      </button>

      {showDropdown && (
        <div style={styles.dropdown}>
          {orgs.map(org => (
            <button
              key={org.id}
              onClick={() => handleOrgChange(org.id)}
              style={{
                ...styles.dropdownItem,
                background: org.id === selectedOrg ? '#d0d0f0' : '#ffffff'
              }}
            >
              {org.logo_url && (
                <img src={org.logo_url} alt="" style={styles.dropdownLogo} />
              )}
              <div style={styles.dropdownInfo}>
                <div style={styles.dropdownName}>{org.name}</div>
                <div style={styles.dropdownMeta}>
                  {org.role} • {org.business_type}
                  {org.is_verified && ' • ✓'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'relative' as const,
    marginBottom: '12px'
  },
  button: {
    width: '100%',
    background: '#ffffff',
    border: '2px solid #c0c0c0',
    borderRadius: '4px',
    padding: '12px',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  buttonContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  logo: {
    width: '36px',
    height: '36px',
    borderRadius: '4px',
    objectFit: 'cover' as const,
    border: '1px solid #c0c0c0'
  },
  orgInfo: {
    flex: 1,
    textAlign: 'left' as const
  },
  orgName: {
    fontSize: '14px',
    fontWeight: 'bold'
  },
  orgRole: {
    fontSize: '11px',
    color: '#666',
    textTransform: 'capitalize' as const
  },
  arrow: {
    fontSize: '12px',
    color: '#666'
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '4px',
    background: '#ffffff',
    border: '2px solid #000080',
    borderRadius: '4px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    zIndex: 1000,
    maxHeight: '300px',
    overflowY: 'auto' as const
  },
  dropdownItem: {
    width: '100%',
    padding: '12px',
    border: 'none',
    borderBottom: '1px solid #e0e0e0',
    background: '#ffffff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'left' as const,
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  dropdownLogo: {
    width: '32px',
    height: '32px',
    borderRadius: '4px',
    objectFit: 'cover' as const
  },
  dropdownInfo: {
    flex: 1
  },
  dropdownName: {
    fontSize: '13px',
    fontWeight: 'bold'
  },
  dropdownMeta: {
    fontSize: '11px',
    color: '#666'
  }
};

