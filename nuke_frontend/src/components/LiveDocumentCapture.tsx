import React, { useState } from 'react';

interface LiveDocumentCaptureProps {
  onCancel: () => void;
  onSendPrompt: () => void;
}

const LiveDocumentCapture: React.FC<LiveDocumentCaptureProps> = ({ onCancel, onSendPrompt }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [method, setMethod] = useState<'sms' | 'email'>('sms');

  const handleSendPrompt = () => {
    if (method === 'sms' && !phoneNumber) return;
    if (method === 'email' && !email) return;
    
    // Here you would integrate with your SMS/email service
    // For now, we'll just call the callback
    onSendPrompt();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded p-4 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <div className="text-sm font-medium">Document Verification</div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 text-xs"
          >
            Close
          </button>
        </div>

        <div className="mb-4 p-3 bg-gray-50 rounded text-xs text-gray-700">
          For verification, we need a fresh photo of your document taken with your phone camera. This prevents use of old or altered documents.
        </div>

        <div className="mb-4">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setMethod('sms')}
              className={`flex-1 py-2 px-3 text-xs rounded ${
                method === 'sms' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Send SMS Link
            </button>
            <button
              onClick={() => setMethod('email')}
              className={`flex-1 py-2 px-3 text-xs rounded ${
                method === 'email' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Send Email Link
            </button>
          </div>

          {method === 'sms' && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Phone Number</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="(555) 123-4567"
                className="w-full p-2 border border-gray-300 rounded text-xs"
              />
            </div>
          )}

          {method === 'email' && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full p-2 border border-gray-300 rounded text-xs"
              />
            </div>
          )}
        </div>

        <div className="mb-4 p-2 bg-blue-50 rounded text-xs text-blue-700">
          A secure link will be sent to capture your document photo. The link expires in 15 minutes.
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-2 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSendPrompt}
            disabled={method === 'sms' ? !phoneNumber : !email}
            className="px-4 py-2 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Send Link
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveDocumentCapture;
