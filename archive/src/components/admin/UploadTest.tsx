import React, { useState } from 'react';
import { testVehicleUpload } from '../../lib/tests/upload-test';
import { useSession } from '@supabase/auth-helpers-react';

export const UploadTest: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string>('');
  const session = useSession();

  const handleTest = async () => {
    if (!session?.user?.id) {
      setResult('Error: No user session found');
      return;
    }

    setIsRunning(true);
    setResult('Starting test...');

    try {
      await testVehicleUpload(session.user.id);
      setResult('Test completed successfully! Check console for details.');
    } catch (error) {
      setResult(`Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Upload Test</h2>
      <button
        onClick={handleTest}
        disabled={isRunning}
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
      >
        {isRunning ? 'Running Test...' : 'Run Upload Test'}
      </button>
      {result && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <pre className="whitespace-pre-wrap">{result}</pre>
        </div>
      )}
    </div>
  );
}; 