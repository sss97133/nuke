/**
 * QI Author Detail — all classified questions by one author
 * Category distribution + paginated comment list
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { L1_COLORS, fmtK } from './constants';
import QICommentRow, { QIComment } from './QICommentRow';
import QIPagination from './QIPagination';

interface CategoryDist {
  l1: string;
  l2: string;
  count: number;
}

interface Props {
  author: string;
}

export default function QIAuthorDetail({ author }: Props) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get('page') || 0));
  const pageSize = 50;

  const [comments, setComments] = useState<QIComment[]>([]);
  const [totalComments, setTotalComments] = useState(0);
  const [categoryDist, setCategoryDist] = useState<CategoryDist[]>([]);
  const [loading, setLoading] = useState(true);

  // Sanitize author for SQL — strip anything that could escape quotes
  const authorSafe = author.replace(/[^a-zA-Z0-9_\-. ]/g, '');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      // Fetch comments by this author (PostgREST — parameterized, safe)
      const { data: commentData, count } = await supabase
        .from('auction_comments')
        .select('id, comment_text, author_username, posted_at, vehicle_id, question_classify_method, sentiment, question_primary_l1, question_primary_l2', { count: 'exact' })
        .eq('author_username', author)
        .not('question_primary_l1', 'is', null)
        .order('posted_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (!cancelled) {
        setComments(commentData || []);
        setTotalComments(count || 0);
      }

      // Category distribution
      const { data: distData } = await supabase.rpc('execute_sql', {
        query: `SELECT question_primary_l1 as l1, question_primary_l2 as l2, count(*)::int as count
          FROM auction_comments
          WHERE author_username = '${authorSafe}'
            AND has_question = true AND question_primary_l1 IS NOT NULL
          GROUP BY question_primary_l1, question_primary_l2
          ORDER BY count DESC LIMIT 20`
      });

      if (!cancelled && distData) {
        setCategoryDist(distData);
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [author, authorSafe, page]);

  const totalByAuthor = categoryDist.reduce((s, d) => s + d.count, 0);

  if (loading && comments.length === 0) {
    return <div style={{ padding: '16px', fontSize: 'var(--fs-9)', color: 'var(--text-disabled)' }}>Loading…</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        border: '2px solid var(--border)',
        background: 'var(--surface)',
        padding: '12px',
        marginBottom: '12px',
      }}>
        <div style={{
          fontSize: 'var(--fs-11)',
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          color: 'var(--text)',
          marginBottom: '4px',
        }}>@{author}</div>
        <div style={{
          fontSize: 'var(--fs-8)',
          fontFamily: "'Courier New', monospace",
          color: 'var(--text-secondary)',
        }}>{fmtK(totalByAuthor)} classified questions across {categoryDist.length} categories</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: categoryDist.length > 0 ? '1fr 260px' : '1fr', gap: '12px' }}>
        {/* Comments */}
        <div>
          <div style={{
            fontSize: 'var(--fs-8)',
            fontFamily: 'Arial, sans-serif',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-secondary)',
            marginBottom: '8px',
          }}>Questions {loading && '(loading…)'}</div>
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '0 12px',
          }}>
            {comments.length === 0 && !loading && (
              <div style={{ padding: '16px 0', fontSize: 'var(--fs-9)', color: 'var(--text-disabled)' }}>No questions found</div>
            )}
            {comments.map(c => <QICommentRow key={c.id} comment={c} />)}
            <QIPagination total={totalComments} pageSize={pageSize} />
          </div>
        </div>

        {/* Category distribution */}
        {categoryDist.length > 0 && (
          <div>
            <div style={{
              fontSize: 'var(--fs-8)',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-secondary)',
              marginBottom: '8px',
            }}>Category Distribution</div>
            <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
              {categoryDist.map(d => (
                <div
                  key={`${d.l1}-${d.l2}`}
                  onClick={() => setParams({ l2: d.l2 })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    borderBottom: '2px solid var(--border)',
                    cursor: 'pointer',
                    fontSize: 'var(--fs-8)',
                    fontFamily: "'Courier New', monospace",
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '6px', height: '6px', background: L1_COLORS[d.l1] || '#6b7d9d' }} />
                    <span style={{ color: 'var(--text)' }}>{d.l2.replace(/_/g, ' ')}</span>
                  </div>
                  <span style={{ color: 'var(--text-secondary)' }}>{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
