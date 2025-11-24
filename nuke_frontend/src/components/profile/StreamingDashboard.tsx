import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import LivePlayer from './LivePlayer';
import { useToast } from '../../hooks/useToast';

interface StreamingDashboardProps {
  userId: string;
  isOwnProfile: boolean;
}

interface StreamSession {
  id: string;
  user_id: string;
  title: string;
  description: string;
  stream_url: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_live: boolean;
  viewer_count: number;
  created_at: string;
}

const StreamingDashboard: React.FC<StreamingDashboardProps> = ({ userId, isOwnProfile }) => {
  const [streams, setStreams] = useState<StreamSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingStream, setEditingStream] = useState<StreamSession | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadStreams();
  }, [userId]);

  const loadStreams = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('stream_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setStreams(data || []);
    } catch (error) {
      console.error('Error loading streams:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStream = async (stream: Partial<StreamSession>) => {
    try {
      if (editingStream?.id) {
        const { error } = await supabase
          .from('stream_sessions')
          .update({
            ...stream,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingStream.id);

        if (error) throw error;
        showToast('Stream updated', 'success');
      } else {
        const { error } = await supabase
          .from('stream_sessions')
          .insert({
            user_id: userId,
            ...stream,
            is_live: false,
            viewer_count: 0
          });

        if (error) throw error;
        showToast('Stream scheduled', 'success');
      }
      setEditingStream(null);
      setShowScheduleForm(false);
      loadStreams();
    } catch (error: any) {
      console.error('Error saving stream:', error);
      showToast(error?.message || 'Failed to save stream', 'error');
    }
  };

  const handleDeleteStream = async (streamId: string) => {
    if (!confirm('Are you sure you want to delete this stream?')) return;

    try {
      const { error } = await supabase
        .from('stream_sessions')
        .delete()
        .eq('id', streamId);

      if (error) throw error;
      showToast('Stream deleted', 'success');
      loadStreams();
    } catch (error: any) {
      console.error('Error deleting stream:', error);
      showToast(error?.message || 'Failed to delete stream', 'error');
    }
  };

  const handleGoLive = async (streamId: string) => {
    try {
      const { error } = await supabase
        .from('stream_sessions')
        .update({ is_live: true })
        .eq('id', streamId);

      if (error) throw error;
      showToast('Stream is now live!', 'success');
      loadStreams();
    } catch (error: any) {
      console.error('Error going live:', error);
      showToast(error?.message || 'Failed to go live', 'error');
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
          <div className="text text-muted">Loading streaming dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Live Player */}
      <div className="card">
        <div className="card-header">
          <h3 className="heading-3">Live Stream</h3>
        </div>
        <div className="card-body">
          <LivePlayer userId={userId} isOwnProfile={isOwnProfile} />
        </div>
      </div>

      {/* Stream Management */}
      {isOwnProfile && (
        <>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="heading-3">Stream Sessions ({streams.length})</h3>
              <button
                onClick={() => {
                  setEditingStream(null);
                  setShowScheduleForm(true);
                }}
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '6px 12px' }}
              >
                + Schedule Stream
              </button>
            </div>
            <div className="card-body">
              {/* Schedule Form */}
              {showScheduleForm && (
                <div style={{
                  padding: 'var(--space-3)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  marginBottom: 'var(--space-3)',
                  background: 'var(--grey-50)'
                }}>
                  <StreamForm
                    stream={editingStream}
                    onSave={handleSaveStream}
                    onCancel={() => {
                      setEditingStream(null);
                      setShowScheduleForm(false);
                    }}
                  />
                </div>
              )}

              {/* Streams List */}
              {streams.length === 0 ? (
                <div className="text text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                  No streams scheduled. Schedule your first stream!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {streams.map(stream => (
                    <div
                      key={stream.id}
                      style={{
                        padding: 'var(--space-3)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        background: stream.is_live ? 'var(--success-dim)' : 'var(--white)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-2)' }}>
                        <div style={{ flex: 1 }}>
                          <h4 className="text font-bold" style={{ marginBottom: '4px' }}>
                            {stream.title}
                            {stream.is_live && (
                              <span style={{
                                marginLeft: '8px',
                                padding: '2px 6px',
                                background: 'var(--error)',
                                color: 'white',
                                fontSize: '7pt',
                                borderRadius: '2px'
                              }}>
                                LIVE
                              </span>
                            )}
                          </h4>
                          {stream.description && (
                            <div className="text text-small text-muted" style={{ marginBottom: '4px' }}>
                              {stream.description}
                            </div>
                          )}
                          <div className="text text-small text-muted">
                            {stream.scheduled_start && (
                              <span>Scheduled: {new Date(stream.scheduled_start).toLocaleString()}</span>
                            )}
                            {stream.viewer_count > 0 && (
                              <span style={{ marginLeft: '12px' }}>👁️ {stream.viewer_count} viewers</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {!stream.is_live && (
                            <button
                              onClick={() => handleGoLive(stream.id)}
                              className="button button-primary"
                              style={{ fontSize: '8pt', padding: '4px 8px' }}
                            >
                              Go Live
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingStream(stream);
                              setShowScheduleForm(false);
                            }}
                            className="button button-secondary"
                            style={{ fontSize: '8pt', padding: '4px 8px' }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteStream(stream.id)}
                            className="button button-secondary"
                            style={{ fontSize: '8pt', padding: '4px 8px' }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Analytics */}
          <div className="card">
            <div className="card-header">
              <h3 className="heading-3">Stream Analytics</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                <div style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: '4px', textAlign: 'center' }}>
                  <div className="text text-small text-muted">Total Streams</div>
                  <div className="text font-bold" style={{ fontSize: '16pt' }}>{streams.length}</div>
                </div>
                <div style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: '4px', textAlign: 'center' }}>
                  <div className="text text-small text-muted">Total Viewers</div>
                  <div className="text font-bold" style={{ fontSize: '16pt' }}>
                    {streams.reduce((sum, s) => sum + s.viewer_count, 0)}
                  </div>
                </div>
                <div style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: '4px', textAlign: 'center' }}>
                  <div className="text text-small text-muted">Live Now</div>
                  <div className="text font-bold" style={{ fontSize: '16pt' }}>
                    {streams.filter(s => s.is_live).length}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

interface StreamFormProps {
  stream: StreamSession | null;
  onSave: (stream: Partial<StreamSession>) => void;
  onCancel: () => void;
}

const StreamForm: React.FC<StreamFormProps> = ({ stream, onSave, onCancel }) => {
  const [title, setTitle] = useState(stream?.title || '');
  const [description, setDescription] = useState(stream?.description || '');
  const [streamUrl, setStreamUrl] = useState(stream?.stream_url || '');
  const [scheduledStart, setScheduledStart] = useState(
    stream?.scheduled_start ? new Date(stream.scheduled_start).toISOString().slice(0, 16) : ''
  );
  const [scheduledEnd, setScheduledEnd] = useState(
    stream?.scheduled_end ? new Date(stream.scheduled_end).toISOString().slice(0, 16) : ''
  );

  const handleSubmit = () => {
    if (!title.trim()) {
      alert('Title is required');
      return;
    }

    onSave({
      title: title.trim(),
      description: description.trim(),
      stream_url: streamUrl.trim(),
      scheduled_start: scheduledStart ? new Date(scheduledStart).toISOString() : null,
      scheduled_end: scheduledEnd ? new Date(scheduledEnd).toISOString() : null
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <input
        type="text"
        placeholder="Stream title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="form-input"
        style={{ fontSize: '10pt', padding: '8px' }}
      />
      <textarea
        placeholder="Stream description..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="form-input"
        style={{ fontSize: '9pt', padding: '8px', minHeight: '80px', fontFamily: 'inherit' }}
      />
      <input
        type="text"
        placeholder="Stream URL (RTMP, HLS, etc.)"
        value={streamUrl}
        onChange={(e) => setStreamUrl(e.target.value)}
        className="form-input"
        style={{ fontSize: '9pt', padding: '6px 8px' }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <div style={{ flex: 1 }}>
          <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
            Scheduled Start
          </label>
          <input
            type="datetime-local"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            className="form-input"
            style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="text text-small font-bold" style={{ display: 'block', marginBottom: '4px' }}>
            Scheduled End
          </label>
          <input
            type="datetime-local"
            value={scheduledEnd}
            onChange={(e) => setScheduledEnd(e.target.value)}
            className="form-input"
            style={{ width: '100%', fontSize: '9pt', padding: '6px 8px' }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button
          onClick={handleSubmit}
          className="button button-primary"
          style={{ fontSize: '9pt', padding: '6px 12px' }}
        >
          {stream ? 'Update' : 'Schedule'}
        </button>
        <button
          onClick={onCancel}
          className="button button-secondary"
          style={{ fontSize: '9pt', padding: '6px 12px' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default StreamingDashboard;

