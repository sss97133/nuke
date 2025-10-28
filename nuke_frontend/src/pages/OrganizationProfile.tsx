import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface Organization {
  id: string;
  name: string;
  business_type: string;
  description?: string;
  logo_url?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  status: string;
  verification_level: string;
  is_public: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface TimelineEvent {
  id: string;
  event_type: string;
  title: string;
  description?: string;
  event_date: string;
  created_by: string;
  created_at: string;
  documentation_urls?: string[];
  uploader_name?: string;
  uploader_role?: string;
}

interface TeamMember {
  user_id: string;
  role: string;
  can_edit: boolean;
  can_invite: boolean;
  can_manage_finances: boolean;
  user_name?: string;
  user_avatar?: string;
  contribution_count?: number;
}

export default function OrganizationProfile() {
  const { id } = useParams<{ id: string }>();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'team' | 'images'>('overview');
  const [userRole, setUserRole] = useState<TeamMember | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadOrganization();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, [id]);

  const loadOrganization = async () => {
    if (!id) return;

    try {
      setLoading(true);

      // Load organization
      const { data: org, error: orgError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', id)
        .single();

      if (orgError) throw orgError;
      setOrganization(org);

      // Load timeline events
      const { data: events, error: eventsError } = await supabase
        .from('business_timeline_events')
        .select('*')
        .eq('business_id', id)
        .order('event_date', { ascending: false });

      if (!eventsError && events) {
        // Enrich with uploader names
        const enriched = await Promise.all(
          events.map(async (event) => {
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('id', event.created_by)
              .single();

            const { data: role } = await supabase
              .from('business_user_roles')
              .select('role')
              .eq('business_id', id)
              .eq('user_id', event.created_by)
              .single();

            return {
              ...event,
              uploader_name: profile?.full_name || 'Unknown',
              uploader_role: role?.role || 'contributor'
            };
          })
        );
        setTimeline(enriched);
      }

      // Load team members
      const { data: teamMembers, error: teamError } = await supabase
        .from('business_user_roles')
        .select('*')
        .eq('business_id', id);

      if (!teamError && teamMembers) {
        const enrichedTeam = await Promise.all(
          teamMembers.map(async (member) => {
            const { data: profile } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('id', member.user_id)
              .single();

            const { count } = await supabase
              .from('business_timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('business_id', id)
              .eq('created_by', member.user_id);

            return {
              ...member,
              user_name: profile?.full_name || 'Unknown',
              user_avatar: profile?.avatar_url,
              contribution_count: count || 0
            };
          })
        );
        setTeam(enrichedTeam);

        // Find current user's role
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const myRole = enrichedTeam.find(m => m.user_id === session.user.id);
          setUserRole(myRole || null);
        }
      }

      // Load images from timeline events
      const allImages: any[] = [];
      events?.forEach(event => {
        event.documentation_urls?.forEach((url: string) => {
          allImages.push({
            id: `${event.id}-${url}`,
            url,
            event_id: event.id,
            event_title: event.title,
            event_date: event.event_date
          });
        });
      });
      setImages(allImages);

    } catch (error: any) {
      console.error('Error loading organization:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getBusinessTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      restoration_shop: 'Restoration Shop',
      dealership: 'Dealership',
      garage: 'Auto Garage',
      performance_shop: 'Performance Shop',
      body_shop: 'Body Shop',
      upholstery: 'Upholstery Shop',
      detailing: 'Detailing',
      mobile_service: 'Mobile Service',
      parts_supplier: 'Parts Supplier',
      fabrication: 'Fabrication',
      racing_team: 'Racing Team',
      other: 'Other'
    };
    return types[type] || type;
  };

  const getVerificationBadge = (level: string) => {
    const badges: Record<string, { emoji: string; label: string; color: string }> = {
      level_1: { emoji: '📋', label: 'Basic Profile', color: '#808080' },
      level_2: { emoji: '✓', label: 'Docs Submitted', color: '#0000ff' },
      level_3: { emoji: '✓✓', label: 'Verified Business', color: '#008000' }
    };
    return badges[level] || badges.level_1;
  };

  const getRoleLabel = (role: string) => {
    const roles: Record<string, string> = {
      owner: 'Owner',
      co_founder: 'Co-Founder',
      board_member: 'Board Member',
      manager: 'Manager',
      technician: 'Technician',
      moderator: 'Moderator',
      contributor: 'Contributor'
    };
    return roles[role] || role;
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading organization...</div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Organization not found</div>
        <button
          onClick={() => navigate('/shops')}
          style={{
            marginTop: 'var(--space-3)',
            background: 'var(--grey-100)',
            border: '2px outset var(--border)',
            padding: '8px 16px',
            fontSize: '9pt',
            cursor: 'pointer',
            fontFamily: '"MS Sans Serif", sans-serif'
          }}
        >
          Back to Organizations
        </button>
      </div>
    );
  }

  const badge = getVerificationBadge(organization.verification_level);

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{
        background: 'var(--white)',
        borderBottom: '2px solid var(--border)',
        padding: 'var(--space-3)'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <button
            onClick={() => navigate('/shops')}
            style={{
              background: 'var(--grey-100)',
              border: '2px outset var(--border)',
              padding: '4px 8px',
              fontSize: '9pt',
              cursor: 'pointer',
              marginBottom: 'var(--space-2)',
              fontFamily: '"MS Sans Serif", sans-serif'
            }}
          >
            ← Back
          </button>

          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            {/* Logo */}
            {organization.logo_url ? (
              <div style={{
                width: '100px',
                height: '100px',
                border: '2px solid var(--border)',
                backgroundImage: `url(${organization.logo_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }} />
            ) : (
              <div style={{
                width: '100px',
                height: '100px',
                border: '2px solid var(--border)',
                background: 'var(--grey-100)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32pt'
              }}>
                🏢
              </div>
            )}

            {/* Info */}
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: '4px' }}>
                {organization.name}
              </h1>
              <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                {getBusinessTypeLabel(organization.business_type)}
                {organization.city && organization.state && (
                  <> · {organization.city}, {organization.state}</>
                )}
              </div>

              {/* Verification Badge */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: badge.color,
                color: '#ffffff',
                padding: '4px 8px',
                fontSize: '8pt',
                fontWeight: 'bold',
                border: '1px outset #ffffff',
                marginBottom: '8px'
              }}>
                {badge.emoji} {badge.label}
              </div>

              {organization.description && (
                <p style={{ fontSize: '9pt', marginTop: '8px', lineHeight: 1.5 }}>
                  {organization.description}
                </p>
              )}

              {/* Contact Info */}
              <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '8pt' }}>
                {organization.phone && <span>📞 {organization.phone}</span>}
                {organization.email && <span>📧 {organization.email}</span>}
                {organization.website && (
                  <a href={organization.website} target="_blank" rel="noopener noreferrer">
                    🌐 Website
                  </a>
                )}
              </div>
            </div>

            {/* Stats */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '12px',
              fontSize: '9pt',
              textAlign: 'center'
            }}>
              <div>
                <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{timeline.length}</div>
                <div style={{ color: 'var(--text-muted)' }}>Events</div>
              </div>
              <div>
                <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{images.length}</div>
                <div style={{ color: 'var(--text-muted)' }}>Photos</div>
              </div>
              <div>
                <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>{team.length}</div>
                <div style={{ color: 'var(--text-muted)' }}>Team</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        background: 'var(--white)',
        borderBottom: '2px solid var(--border)'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          gap: '2px'
        }}>
          {(['overview', 'timeline', 'team', 'images'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--grey-200)' : 'var(--grey-100)',
                border: activeTab === tab ? '2px inset var(--border)' : '2px outset var(--border)',
                padding: '8px 16px',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif',
                textTransform: 'capitalize'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: 'var(--space-4)' }}>
        {activeTab === 'overview' && (
          <div>
            {/* Recent Activity */}
            <div style={{
              background: 'var(--white)',
              border: '2px solid var(--border)',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-3)'
            }}>
              <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                Recent Activity
              </h2>
              {timeline.slice(0, 5).map(event => (
                <div
                  key={event.id}
                  style={{
                    padding: '12px',
                    borderBottom: '1px solid var(--border-light)',
                    fontSize: '9pt'
                  }}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                    {event.title}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
                    {new Date(event.event_date).toLocaleDateString()} · Added by {event.uploader_name} ({getRoleLabel(event.uploader_role || '')})
                  </div>
                </div>
              ))}
              {timeline.length === 0 && (
                <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-muted)' }}>
                  No events yet
                </div>
              )}
            </div>

            {/* Team Preview */}
            <div style={{
              background: 'var(--white)',
              border: '2px solid var(--border)',
              padding: 'var(--space-3)'
            }}>
              <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
                Team ({team.length})
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                {team.slice(0, 6).map(member => (
                  <div key={member.user_id} style={{ fontSize: '9pt' }}>
                    <div style={{ fontWeight: 'bold' }}>{member.user_name}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '8pt' }}>
                      {getRoleLabel(member.role)} · {member.contribution_count} contributions
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
              Timeline ({timeline.length} events)
            </h2>
            {timeline.map(event => (
              <div
                key={event.id}
                style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border-light)',
                  fontSize: '9pt'
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: '10pt', marginBottom: '8px' }}>
                  {event.title}
                </div>
                {event.description && (
                  <div style={{ marginBottom: '8px', lineHeight: 1.5 }}>
                    {event.description}
                  </div>
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: '8pt', marginBottom: '8px' }}>
                  {new Date(event.event_date).toLocaleDateString()} · Added by {event.uploader_name} ({getRoleLabel(event.uploader_role || '')})
                </div>
                {event.documentation_urls && event.documentation_urls.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {event.documentation_urls.map((url, idx) => (
                      <div
                        key={idx}
                        style={{
                          width: '100px',
                          height: '100px',
                          backgroundImage: `url(${url})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          border: '1px solid var(--border)',
                          cursor: 'pointer'
                        }}
                        onClick={() => window.open(url, '_blank')}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {timeline.length === 0 && (
              <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                No timeline events yet
              </div>
            )}
          </div>
        )}

        {activeTab === 'team' && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
              Team Members ({team.length})
            </h2>
            {team.map(member => (
              <div
                key={member.user_id}
                style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border-light)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '10pt' }}>
                    {member.user_name}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {getRoleLabel(member.role)}
                  </div>
                </div>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  {member.contribution_count} contributions
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'images' && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-3)'
          }}>
            <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: 'var(--space-2)' }}>
              Images ({images.length})
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '12px'
            }}>
              {images.map(img => (
                <div
                  key={img.id}
                  style={{
                    aspectRatio: '1',
                    backgroundImage: `url(${img.url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                  onClick={() => window.open(img.url, '_blank')}
                  title={img.event_title}
                />
              ))}
            </div>
            {images.length === 0 && (
              <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
                No images yet
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

