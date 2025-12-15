/**
 * Test Page for Contextual Analysis System
 */

import React from 'react';
import TestContextualAnalysis from '../components/admin/TestContextualAnalysis';

const TestContextualAnalysisPage: React.FC = () => {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      padding: '20px'
    }}>
      <TestContextualAnalysis />
    </div>
  );
};

export default TestContextualAnalysisPage;

