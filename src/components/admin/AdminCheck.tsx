import React, { useState } from 'react';
import { checkAndUpdateAdminStatus } from '../../lib/tests/check-admin';

export const AdminCheck: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string>('');

  const handleCheck = async () => {
    setIsRunning(true);
    setResult('Starting admin check...');

    try {
      // Capture console output
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      let output = '';

      console.log = (...args) => {
        output += args.join(' ') + '\n';
        originalConsoleLog.apply(console, args);
      };

      console.error = (...args) => {
        output += 'ERROR: ' + args.join(' ') + '\n';
        originalConsoleError.apply(console, args);
      };

      await checkAndUpdateAdminStatus();
      setResult(output);
    } catch (error) {
      setResult(`Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Admin Status Check</h2>
      <button
        onClick={handleCheck}
        disabled={isRunning}
        className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
      >
        {isRunning ? 'Checking Admin Status...' : 'Check Admin Status'}
      </button>
      {result && (
        <div className="mt-4 p-4 bg-gray-100 rounded">
          <pre className="whitespace-pre-wrap">{result}</pre>
        </div>
      )}
    </div>
  );
}; 