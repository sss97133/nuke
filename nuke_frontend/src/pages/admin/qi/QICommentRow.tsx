/**
 * QI Comment Row — atomic unit of the explorer
 * Shows one classified comment with outbound links
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface QIComment {
  id: string;
  comment_text: string;
  author_username: string | null;
  posted_at: string;
  vehicle_id: string | null;
  question_classify_method: string | null;
  sentiment: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}

interface Props {
  comment: QIComment;
}

export default function QICommentRow({ comment }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [, setParams] = useSearchParams();

  const text = comment.comment_text || '';
  const truncated = text.length > 220 && !expanded;
  const displayText = truncated ? text.slice(0, 220) + '…' : text;

  const vehicleLabel = comment.year && comment.make
    ? `${comment.year} ${comment.make} ${comment.model || ''}`.trim()
    : comment.vehicle_id
      ? comment.vehicle_id.slice(0, 8)
      : null;

  const posted = comment.posted_at
    ? new Date(comment.posted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div style={{
      padding: '8px 0',
      borderBottom: '2px solid var(--border)',
    }}>
      {/* Comment text */}
      <div
        onClick={truncated ? () => setExpanded(true) : undefined}
        style={{
          fontSize: 'var(--fs-9)',
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text)',
          lineHeight: '1.4',
          cursor: truncated ? 'pointer' : 'default',
          marginBottom: '4px',
        }}
      >
        {displayText}
        {truncated && (
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-8)', marginLeft: '4px' }}>[more]</span>
        )}
      </div>

      {/* Meta row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: 'var(--fs-8)',
        fontFamily: "'Courier New', monospace",
        color: 'var(--text-secondary)',
      }}>
        {comment.author_username && (
          <span
            onClick={() => setParams({ author: comment.author_username! })}
            style={{ cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}
            title={`All questions by ${comment.author_username}`}
          >
            @{comment.author_username}
          </span>
        )}

        {vehicleLabel && comment.vehicle_id && (
          <a
            href={`/vehicle/${comment.vehicle_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textUnderlineOffset: '2px' }}
            title="Open vehicle profile"
          >
            {vehicleLabel}
          </a>
        )}

        {comment.question_classify_method && (
          <span style={{
            padding: '0 4px',
            border: '2px solid var(--border)',
            fontSize: 'var(--fs-8)',
            textTransform: 'uppercase',
          }}>
            {comment.question_classify_method}
          </span>
        )}

        {posted && <span>{posted}</span>}
      </div>
    </div>
  );
}
