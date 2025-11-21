import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  times_referenced: number;
  helpfulness_score: number;
  tags: string[] | null;
  is_verified: boolean;
  created_at: string;
}

interface TorqueSpec {
  component: string;
  torque_value: number;
  torque_unit: string;
  tightening_pattern: string | null;
  notes: string | null;
}

const KnowledgeBase: React.FC = () => {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null);
  const [torqueSpecs, setTorqueSpecs] = useState<TorqueSpec[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const categories = ['procedure', 'specification', 'common_issue', 'diagnostic', 'reference'];

  useEffect(() => {
    loadKnowledgeBase();
  }, [categoryFilter]);

  const loadKnowledgeBase = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('knowledge_base')
        .select('*')
        .order('times_referenced', { ascending: false });

      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setEntries(data || []);
    } catch (error) {
      console.error('Error loading knowledge base:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTorqueSpecs = async (knowledgeId: string) => {
    try {
      const { data, error } = await supabase
        .from('torque_specs')
        .select('*')
        .eq('knowledge_id', knowledgeId);

      if (error) throw error;
      setTorqueSpecs(data || []);
    } catch (error) {
      console.error('Error loading torque specs:', error);
    }
  };

  const filteredEntries = entries.filter(entry =>
    searchQuery === '' ||
    entry.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleSelectEntry = (entry: KnowledgeEntry) => {
    setSelectedEntry(entry);
    if (entry.category === 'specification') {
      loadTorqueSpecs(entry.id);
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: 'var(--space-4)' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ 
          marginBottom: 'var(--space-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)'
        }}>
          <h1 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Knowledge Base
          </h1>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search procedures, specs, issues..."
            style={{
              flex: 1,
              maxWidth: '400px',
              padding: 'var(--space-2)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: '9px',
              background: 'var(--surface)',
              color: 'var(--text)'
            }}
          />

          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              padding: '6px var(--space-3)',
              border: '2px solid var(--text)',
              background: 'var(--text)',
              color: 'var(--surface)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              whiteSpace: 'nowrap'
            }}
          >
            ADD KNOWLEDGE
          </button>
        </div>

        {/* Category Filters */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          <button
            onClick={() => setCategoryFilter('all')}
            style={{
              padding: '4px var(--space-2)',
              border: '2px solid var(--border)',
              background: categoryFilter === 'all' ? 'var(--text)' : 'var(--surface)',
              color: categoryFilter === 'all' ? 'var(--surface)' : 'var(--text)',
              fontSize: '9px',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
              textTransform: 'uppercase'
            }}
          >
            ALL
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{
                padding: '4px var(--space-2)',
                border: '2px solid var(--border)',
                background: categoryFilter === cat ? 'var(--text)' : 'var(--surface)',
                color: categoryFilter === cat ? 'var(--surface)' : 'var(--text)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 'var(--radius)',
                textTransform: 'uppercase'
              }}
            >
              {cat.replace('_', ' ')}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            Loading knowledge base...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            No knowledge entries found
            {searchQuery && ` for "${searchQuery}"`}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--space-3)' }}>
            {filteredEntries.map(entry => (
              <div
                key={entry.id}
                onClick={() => handleSelectEntry(entry)}
                style={{
                  background: 'var(--surface)',
                  border: '2px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-3)',
                  cursor: 'pointer',
                  transition: 'var(--transition)',
                  position: 'relative'
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                {entry.is_verified && (
                  <div style={{
                    position: 'absolute',
                    top: 'var(--space-2)',
                    right: 'var(--space-2)',
                    fontSize: '8px',
                    fontWeight: 700,
                    color: 'var(--success)',
                    background: 'var(--success-dim)',
                    padding: '2px 6px',
                    borderRadius: '2px',
                    border: '1px solid var(--success)'
                  }}>
                    VERIFIED
                  </div>
                )}

                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)', marginBottom: '4px', paddingRight: '60px' }}>
                  {entry.title}
                </div>

                <div style={{ 
                  fontSize: '8px',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  marginBottom: 'var(--space-2)'
                }}>
                  {entry.category.replace('_', ' ')}
                </div>

                <div style={{ 
                  fontSize: '9px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.4',
                  marginBottom: 'var(--space-2)',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {entry.content}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--text-secondary)' }}>
                  <span>Used {entry.times_referenced}x</span>
                  {entry.helpfulness_score > 0 && (
                    <span>★ {entry.helpfulness_score.toFixed(1)}/10</span>
                  )}
                </div>

                {entry.tags && entry.tags.length > 0 && (
                  <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                    {entry.tags.slice(0, 3).map(tag => (
                      <span key={tag} style={{
                        fontSize: '8px',
                        padding: '2px 6px',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '2px',
                        color: 'var(--text-secondary)'
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedEntry && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'var(--space-4)'
          }}
          onClick={() => setSelectedEntry(null)}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 'var(--space-4)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'flex-start',
              marginBottom: 'var(--space-3)',
              paddingBottom: 'var(--space-2)',
              borderBottom: '2px solid var(--border)'
            }}>
              <div>
                <h2 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', margin: 0, marginBottom: '4px' }}>
                  {selectedEntry.title}
                </h2>
                <div style={{ fontSize: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  {selectedEntry.category.replace('_', ' ')}
                  {selectedEntry.is_verified && (
                    <span style={{ 
                      marginLeft: 'var(--space-2)',
                      color: 'var(--success)',
                      fontWeight: 700
                    }}>
                      • VERIFIED
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedEntry(null)}
                style={{
                  padding: '4px var(--space-2)',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)'
                }}
              >
                CLOSE
              </button>
            </div>

            <div style={{ 
              fontSize: '9px',
              color: 'var(--text)',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              marginBottom: 'var(--space-4)'
            }}>
              {selectedEntry.content}
            </div>

            {torqueSpecs.length > 0 && (
              <div style={{
                background: 'var(--bg)',
                border: '2px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 'var(--space-3)',
                marginBottom: 'var(--space-3)'
              }}>
                <h3 style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)', marginBottom: 'var(--space-2)' }}>
                  Torque Specifications
                </h3>
                {torqueSpecs.map((spec, idx) => (
                  <div key={idx} style={{ 
                    marginBottom: 'var(--space-2)',
                    paddingBottom: 'var(--space-2)',
                    borderBottom: idx < torqueSpecs.length - 1 ? '1px solid var(--border)' : 'none'
                  }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text)' }}>
                      {spec.component}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
                        {spec.torque_value} {spec.torque_unit}
                      </span>
                      {spec.tightening_pattern && (
                        <span style={{ marginLeft: 'var(--space-2)' }}>
                          Pattern: {spec.tightening_pattern}
                        </span>
                      )}
                    </div>
                    {spec.notes && (
                      <div style={{ fontSize: '8px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {spec.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ 
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '8px',
              color: 'var(--text-secondary)',
              paddingTop: 'var(--space-2)',
              borderTop: '1px solid var(--border)'
            }}>
              <span>Referenced {selectedEntry.times_referenced} times</span>
              {selectedEntry.helpfulness_score > 0 && (
                <span>Helpfulness: ★ {selectedEntry.helpfulness_score.toFixed(1)}/10</span>
              )}
            </div>

            {selectedEntry.tags && selectedEntry.tags.length > 0 && (
              <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                {selectedEntry.tags.map(tag => (
                  <span key={tag} style={{
                    fontSize: '8px',
                    padding: '2px 6px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: '2px',
                    color: 'var(--text-secondary)',
                    fontWeight: 600
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;

