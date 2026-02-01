import React, { useState } from 'react';

const CommentingGuide: React.FC = () => {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return (
      <div className="commenting-guide-collapsed">
        <button 
          onClick={() => setIsVisible(true)}
          className="button button-small"
          title="Show commenting guide"
        >
          💬 How to Comment
        </button>
      </div>
    );
  }

  return (
    <div className="commenting-guide">
      <div className="commenting-guide-header">
        <h4>💬 How to Add Comments</h4>
        <button 
          onClick={() => setIsVisible(false)}
          className="commenting-guide-close"
        >
          ×
        </button>
      </div>
      <div className="commenting-guide-content">
        <p className="text-small">
          <strong>Click any vehicle data</strong> (Year, Make, Model, VIN, etc.) to add comments about that specific information.
        </p>
        <div className="commenting-guide-example">
          <span className="commentable demo">2019</span>
          <span className="text-small text-muted">← Click data like this to comment</span>
        </div>
        <p className="text-small text-muted">
          All comments appear in the Comments section below.
        </p>
      </div>
    </div>
  );
};

export default CommentingGuide;
