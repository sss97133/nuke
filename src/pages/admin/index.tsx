import React from 'react';
import { DataCheck } from '../../components/admin/DataCheck';
import { UploadTest } from '../../components/admin/UploadTest';

export const AdminPage: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">Admin Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <UploadTest />
        </div>
        <div>
          <DataCheck />
        </div>
      </div>
    </div>
  );
}; 