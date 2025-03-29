import React, { useState, useEffect } from 'react';
import { checkAdminStatus } from '../../lib/tests/check-admin';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Shield, UserCog } from 'lucide-react';

export const AdminCheck: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [adminStatus, setAdminStatus] = useState<{
    isAdmin: boolean;
    error?: string;
    userType?: string;
  } | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setIsRunning(true);
    try {
      const status = await checkAdminStatus();
      setAdminStatus(status);
    } catch (error) {
      setAdminStatus({ 
        isAdmin: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    } finally {
      setIsRunning(false);
    }
  };

  if (isRunning) {
    return (
      <div className="p-4">
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center space-x-2 mb-4">
        <Shield className="h-5 w-5 text-blue-500" />
        <h2 className="text-xl font-bold">Admin Access Status</h2>
      </div>

      {adminStatus?.isAdmin ? (
        <Alert className="bg-green-50 border-green-200">
          <UserCog className="h-4 w-4 text-green-500" />
          <AlertTitle>Admin Access Granted</AlertTitle>
          <AlertDescription>
            You have administrative privileges. Your user type is: {adminStatus.userType || 'professional'}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Access Restricted</AlertTitle>
          <AlertDescription>
            {adminStatus?.error || 'You do not have administrative privileges.'}
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-4 text-sm text-gray-600">
        <p>This page is protected and requires administrative privileges to access.</p>
        <p className="mt-2">If you believe you should have access, please contact your system administrator.</p>
      </div>
    </div>
  );
}; 