import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SignaturePad from '../components/SignaturePad';
import ShippingTracker from '../components/ShippingTracker';
import { getTransactionByToken, submitSignature } from '../services/vehicleTransactionService';
import type { VehicleTransaction } from '../services/vehicleTransactionService';

const SignDocument: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  const [transaction, setTransaction] = useState<VehicleTransaction | null>(null);
  const [userType, setUserType] = useState<'buyer' | 'seller'>('buyer');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fullySigned, setFullySigned] = useState(false);

  useEffect(() => {
    loadTransaction();
  }, [token]);

  const loadTransaction = async () => {
    if (!token) {
      setError('Invalid signing link');
      setLoading(false);
      return;
    }

    try {
      // Try buyer first
      let tx = await getTransactionByToken(token, 'buyer');
      let type: 'buyer' | 'seller' = 'buyer';
      
      if (!tx) {
        // Try seller
        tx = await getTransactionByToken(token, 'seller');
        type = 'seller';
      }

      if (!tx) {
        setError('Transaction not found or link expired');
        setLoading(false);
        return;
      }

      // Check if already signed
      if (tx[`${type}_signed_at`]) {
        setSuccess(true);
        setFullySigned(!!(tx.buyer_signed_at && tx.seller_signed_at));
      }

      setTransaction(tx);
      setUserType(type);
    } catch (err: any) {
      console.error('Failed to load transaction:', err);
      setError(err.message || 'Failed to load transaction');
    } finally {
      setLoading(false);
    }
  };

  const handleSignature = async (signatureDataUrl: string) => {
    if (!token || !transaction) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitSignature(token, userType, signatureDataUrl);
      
      setSuccess(true);
      setFullySigned(result.fullySigned || false);

      // Reload transaction to show updated status
      await loadTransaction();
    } catch (err: any) {
      console.error('Failed to submit signature:', err);
      setError(err.message || 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <div style={{ fontSize: '10pt' }}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{ 
          maxWidth: '500px', 
          padding: '30px', 
          border: '2px solid #ef4444',
          borderRadius: '0px',
          background: '#fff'
        }}>
          <h2 style={{ fontSize: '14pt', marginBottom: '16px', color: '#ef4444' }}>
            ❌ Error
          </h2>
          <p style={{ fontSize: '9pt', marginBottom: '20px' }}>{error}</p>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '8px 16px',
              border: '2px solid #000',
              background: '#fff',
              fontSize: '9pt',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '0px'
            }}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{ 
          maxWidth: '600px', 
          padding: '40px', 
          border: '2px solid #10b981',
          borderRadius: '0px',
          background: '#fff',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '16pt', marginBottom: '20px', color: '#10b981' }}>
            ✅ Signature Submitted!
          </h2>
          
          {fullySigned ? (
            <>
              <p style={{ fontSize: '10pt', marginBottom: '20px' }}>
                <strong>All documents are now signed!</strong>
              </p>
              <p style={{ fontSize: '9pt', marginBottom: '20px', color: '#666' }}>
                {userType === 'buyer' ? (
                  <>
                    <strong>Next Steps (Buyer):</strong><br/>
                    1. Wire ${transaction?.sale_price.toLocaleString()} to the seller<br/>
                    2. Check your email for payment instructions<br/>
                    3. Coordinate pickup/delivery with seller
                  </>
                ) : (
                  <>
                    <strong>Next Steps (Seller):</strong><br/>
                    1. Wait for buyer's payment of ${transaction?.sale_price.toLocaleString()}<br/>
                    2. Once received, mark as paid in your dashboard<br/>
                    3. Coordinate vehicle delivery with buyer
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: '10pt', marginBottom: '20px' }}>
                Your signature has been recorded. Waiting for the other party to sign.
              </p>
              <p style={{ fontSize: '9pt', color: '#666' }}>
                You'll receive an SMS when all parties have signed.
              </p>
            </>
          )}

          {/* Shipping Tracker (if fully signed) */}
          {fullySigned && transaction && (
            <div style={{ marginTop: '30px' }}>
              <ShippingTracker transactionId={transaction.id} />
            </div>
          )}

          <button
            onClick={() => navigate('/')}
            style={{
              padding: '10px 24px',
              border: '2px solid #000',
              background: '#000',
              color: '#fff',
              fontSize: '9pt',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '0px',
              marginTop: '20px'
            }}
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return null;
  }

  const vehicleName = `${transaction.vehicle?.year} ${transaction.vehicle?.make} ${transaction.vehicle?.model}`;
  const documentType = userType === 'buyer' ? 'Purchase Agreement' : 'Bill of Sale';
  const documentUrl = userType === 'buyer' ? transaction.purchase_agreement_url : transaction.bill_of_sale_url;

  return (
    <div style={{ minHeight: '100vh', padding: '20px', background: 'var(--surface-light, #f5f5f5)' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ 
          background: '#fff', 
          border: '2px solid #000', 
          borderRadius: '0px',
          marginBottom: '20px'
        }}>
          <div style={{ 
            padding: '20px', 
            borderBottom: '2px solid #000',
            background: 'var(--surface-light, #f5f5f5)'
          }}>
            <h1 style={{ fontSize: '16pt', margin: 0 }}>
              Sign {documentType}
            </h1>
            <p style={{ fontSize: '9pt', margin: '8px 0 0', color: '#666' }}>
              {vehicleName}
            </p>
          </div>

          <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '11pt', marginBottom: '12px' }}>Transaction Details:</h3>
              <div style={{ fontSize: '9pt', lineHeight: 1.8 }}>
                <div><strong>Vehicle:</strong> {vehicleName}</div>
                <div><strong>Sale Price:</strong> ${transaction.sale_price.toLocaleString()}</div>
                <div><strong>Status:</strong> Pending Signatures</div>
                <div><strong>You are:</strong> {userType === 'buyer' ? 'Buyer' : 'Seller'}</div>
              </div>
            </div>

            {/* Document Preview */}
            {documentUrl && (
              <div style={{ marginBottom: '30px' }}>
                <h3 style={{ fontSize: '11pt', marginBottom: '12px' }}>Document Preview:</h3>
                <iframe
                  src={documentUrl}
                  style={{
                    width: '100%',
                    height: '400px',
                    border: '1px solid #ccc',
                    borderRadius: '0px'
                  }}
                  title="Document Preview"
                />
                <p style={{ fontSize: '8pt', color: '#666', marginTop: '8px' }}>
                  Scroll to review the entire document before signing
                </p>
              </div>
            )}

            {/* Signature Section */}
            <div style={{ 
              padding: '20px', 
              background: 'var(--surface-light, #f9f9f9)',
              border: '2px solid #000',
              borderRadius: '0px'
            }}>
              <h3 style={{ fontSize: '11pt', marginBottom: '12px' }}>
                {userType === 'buyer' ? '📝 Buyer Signature:' : '📝 Seller Signature:'}
              </h3>
              <p style={{ fontSize: '9pt', marginBottom: '16px', color: '#666' }}>
                By signing below, you acknowledge that you have read and agree to the terms of this {documentType}.
              </p>
              
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <SignaturePad 
                  onSave={handleSignature}
                  onClear={() => {}}
                />
              </div>

              {submitting && (
                <p style={{ fontSize: '9pt', marginTop: '16px', textAlign: 'center', color: '#666' }}>
                  Submitting signature...
                </p>
              )}
            </div>

            <div style={{ 
              marginTop: '20px', 
              padding: '16px', 
              background: '#fffbeb',
              border: '1px solid #f59e0b',
              borderRadius: '0px',
              fontSize: '8pt'
            }}>
              <strong>⚠️ Legal Notice:</strong> This signature is legally binding. By signing, you are entering into a binding contract for the purchase/sale of the vehicle described above. Read the full document carefully before signing.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignDocument;

