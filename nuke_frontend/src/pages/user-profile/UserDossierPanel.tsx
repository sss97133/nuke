/**
 * UserDossierPanel — Grouped field display for user profile data.
 * Mirrors VehicleDossierPanel pattern.
 *
 * Groups: IDENTITY, SOCIAL, ACCOUNT
 * Owner view: inline-editable fields.
 * Public view: read-only, email hidden.
 * Agent view: data-* attributes on every field row.
 */
import React, { useState, useCallback } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useUserProfile } from './UserProfileContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: string;
  value: string | null | undefined;
  isLink?: boolean;
  ownerOnly?: boolean;
  editable?: boolean;
}

// ---------------------------------------------------------------------------
// Field Row
// ---------------------------------------------------------------------------

const DossierRow: React.FC<{
  field: FieldDef;
  isOwner: boolean;
  onSave?: (key: string, value: string) => void;
}> = ({ field, isOwner, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value || '');

  const handleSave = useCallback(() => {
    if (onSave && draft !== (field.value || '')) {
      onSave(field.key, draft);
    }
    setEditing(false);
  }, [onSave, draft, field.key, field.value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setDraft(field.value || ''); setEditing(false); }
  }, [handleSave, field.value]);

  if (!field.value && !isOwner) return null;

  return (
    <div
      className="up-dossier-row"
      data-field-name={field.key}
      data-field-value={field.value || ''}
    >
      <span className="up-dossier-row__label">{field.label}</span>
      <span className="up-dossier-row__value">
        {editing && isOwner && field.editable ? (
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
            style={{
              fontFamily: 'var(--up-font-sans)',
              fontSize: '9px',
              border: '1px solid var(--up-ghost)',
              padding: '1px 4px',
              width: '120px',
              textAlign: 'right',
            }}
          />
        ) : field.isLink && field.value ? (
          <a href={field.value} target="_blank" rel="noreferrer">
            {formatLinkDisplay(field.value)}
          </a>
        ) : (
          <span
            onClick={isOwner && field.editable ? () => { setDraft(field.value || ''); setEditing(true); } : undefined}
            style={isOwner && field.editable ? { cursor: 'pointer' } : undefined}
          >
            {field.value || <span style={{ color: 'var(--up-text-faint)', fontStyle: 'italic', fontSize: '8px' }}>SET</span>}
          </span>
        )}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLinkDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '') + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch {
    return url;
  }
}

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UserDossierPanel: React.FC = () => {
  const { profile, isOwnProfile, saveProfileField } = useUserProfile();

  if (!profile) return null;

  const handleSave = useCallback(async (key: string, value: string) => {
    await saveProfileField(key, value);
  }, [saveProfileField]);

  // ── Field groups ──

  const identityFields: FieldDef[] = [
    { key: 'full_name', label: 'NAME', value: profile.full_name, editable: true },
    { key: 'email', label: 'EMAIL', value: profile.email, ownerOnly: true },
    { key: 'username', label: 'USERNAME', value: profile.username, editable: true },
    { key: 'location', label: 'LOCATION', value: profile.location, editable: true },
    { key: 'member_since', label: 'MEMBER SINCE', value: formatDate(profile.member_since || profile.created_at) },
  ];

  const socialFields: FieldDef[] = [
    { key: 'website', label: 'WEBSITE', value: profile.website, isLink: true, editable: true },
    { key: 'github_url', label: 'GITHUB', value: profile.github_url, isLink: true, editable: true },
    { key: 'linkedin_url', label: 'LINKEDIN', value: profile.linkedin_url, isLink: true, editable: true },
  ];

  const accountFields: FieldDef[] = [
    { key: 'user_type', label: 'TYPE', value: profile.user_type?.toUpperCase() || 'USER' },
    { key: 'verification_status', label: 'VERIFICATION', value: profile.verification_status?.toUpperCase() || null },
    { key: 'is_public', label: 'VISIBILITY', value: profile.is_public ? 'PUBLIC' : 'PRIVATE', ownerOnly: true },
  ];

  // Filter: hide ownerOnly fields for non-owners
  const filterFields = (fields: FieldDef[]) =>
    fields.filter(f => !f.ownerOnly || isOwnProfile);

  const renderGroup = (label: string, fields: FieldDef[]) => {
    const filtered = filterFields(fields);
    const hasAnyValue = filtered.some(f => f.value || isOwnProfile);
    if (!hasAnyValue) return null;
    return (
      <div className="up-dossier-group">
        <div className="up-dossier-group__label">{label}</div>
        {filtered.map(f => (
          <DossierRow
            key={f.key}
            field={f}
            isOwner={isOwnProfile}
            onSave={f.editable ? handleSave : undefined}
          />
        ))}
      </div>
    );
  };

  const identityGroup = renderGroup('IDENTITY', identityFields);
  const socialGroup = renderGroup('SOCIAL', socialFields);
  const accountGroup = renderGroup('ACCOUNT', accountFields);

  if (!identityGroup && !socialGroup && !accountGroup) return null;

  return (
    <CollapsibleWidget variant="profile" title="Dossier">
      {identityGroup}
      {socialGroup}
      {accountGroup}
    </CollapsibleWidget>
  );
};

export default UserDossierPanel;
