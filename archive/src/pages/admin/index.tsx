import React from 'react';
import { AdminCheck } from '../../components/admin/AdminCheck';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Database, Upload } from 'lucide-react';

export const AdminPage: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center space-x-2 mb-8">
        <Shield className="h-6 w-6 text-blue-500" />
        <h1 className="text-2xl font-bold">Administrative Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Access Control Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Shield className="h-5 w-5 text-blue-500" />
              <CardTitle>Access Control</CardTitle>
            </div>
            <CardDescription>
              Verify and manage administrative access
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminCheck />
          </CardContent>
        </Card>

        {/* Data Management Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Database className="h-5 w-5 text-green-500" />
              <CardTitle>Data Management</CardTitle>
            </div>
            <CardDescription>
              Monitor and manage system data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Data management tools are currently under development.
              This section will provide tools for:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
              <li>Database monitoring</li>
              <li>Data backup and restore</li>
              <li>System health checks</li>
            </ul>
          </CardContent>
        </Card>

        {/* Upload Management Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Upload className="h-5 w-5 text-purple-500" />
              <CardTitle>Upload Management</CardTitle>
            </div>
            <CardDescription>
              Monitor and manage file uploads
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              Upload management tools are currently under development.
              This section will provide tools for:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
              <li>File upload monitoring</li>
              <li>Storage management</li>
              <li>Upload validation</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h2 className="text-lg font-semibold mb-2">Security Notice</h2>
        <p className="text-sm text-gray-600">
          This administrative dashboard is protected and requires proper authentication and authorization.
          All actions are logged and monitored for security purposes.
        </p>
      </div>
    </div>
  );
}; 