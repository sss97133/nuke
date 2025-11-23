/**
 * Payment Method Setup Component
 * Modal for adding payment method before first bid
 */

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import AuctionPaymentService from '../../services/auctionPaymentService';
import '../../design-system.css';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

interface PaymentMethodSetupProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function PaymentSetupForm({ onSuccess, onCancel }: PaymentMethodSetupProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError('Card element not found');
      setLoading(false);
      return;
    }

    const result = await AuctionPaymentService.setupPaymentMethod(cardElement);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error || 'Failed to setup payment method');
    }

    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Card Information
        </label>
        <div className="p-3 border border-gray-300 rounded">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#424770',
                  '::placeholder': {
                    color: '#aab7c4',
                  },
                },
                invalid: {
                  color: '#9e2146',
                },
              },
            }}
          />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Processing...' : 'Add Payment Method'}
        </button>
      </div>
    </form>
  );
}

export default function PaymentMethodSetup({ onSuccess, onCancel }: PaymentMethodSetupProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h2 className="text-2xl font-bold mb-4">Add Payment Method</h2>
        <p className="text-sm text-gray-600 mb-6">
          We'll place a temporary hold on your card when you bid. The hold is released if you're
          outbid, or charged if you win.
        </p>

        <Elements stripe={stripePromise}>
          <PaymentSetupForm onSuccess={onSuccess} onCancel={onCancel} />
        </Elements>

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
          <p className="font-medium mb-1">Secure Payment Processing</p>
          <p>
            Your payment information is processed securely by Stripe. We never store your full card
            details on our servers.
          </p>
        </div>
      </div>
    </div>
  );
}

