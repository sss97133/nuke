import React, { useRef, useState, useEffect } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';

interface DigitalSignatureProps {
  signerName: string;
  signerRole: 'buyer' | 'co_buyer' | 'seller';
  agreementId: string;
  userId: string;
  onSigned?: (signature: SignatureData) => void;
  disabled?: boolean;
}

interface SignatureData {
  image: string; // Base64 encoded image
  timestamp: string;
  signerName: string;
  signerRole: string;
}

export default function DigitalSignature({
  signerName,
  signerRole,
  agreementId,
  userId,
  onSigned,
  disabled = false
}: DigitalSignatureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [signatureExists, setSignatureExists] = useState(false);
  const [lastX, setLastX] = useState(0);
  const [lastY, setLastY] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = 400;
    canvas.height = 150;

    // Set drawing properties
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add signature line
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 20);
    ctx.lineTo(canvas.width - 20, canvas.height - 20);
    ctx.stroke();

    // Reset drawing properties
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setLastX(clientX - rect.left);
    setLastY(clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const currentX = clientX - rect.left;
    const currentY = clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();

    setLastX(currentX);
    setLastY(currentY);
    setSignatureExists(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    if (disabled) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Redraw signature line
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, canvas.height - 20);
    ctx.lineTo(canvas.width - 20, canvas.height - 20);
    ctx.stroke();

    // Reset drawing properties
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;

    setSignatureExists(false);
  };

  const submitSignature = async () => {
    if (!signatureExists || disabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsSigning(true);

    try {
      // Convert canvas to base64 image
      const imageData = canvas.toDataURL('image/png');

      const signatureData: SignatureData = {
        image: imageData,
        timestamp: new Date().toISOString(),
        signerName,
        signerRole
      };

      // Submit to API
      const response = await fetch(`/api/purchase-agreements/${agreementId}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          signer_role: signerRole,
          signature_data: signatureData,
          user_id: userId
        })
      });

      if (response.ok) {
        onSigned?.(signatureData);
      } else {
        console.error('Failed to submit signature');
        alert('Failed to submit signature. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting signature:', error);
      alert('Error submitting signature. Please try again.');
    } finally {
      setIsSigning(false);
    }
  };

  const getRoleDisplayName = () => {
    switch (signerRole) {
      case 'buyer': return 'Buyer';
      case 'co_buyer': return 'Co-Buyer';
      case 'seller': return 'Seller';
      default: return 'Signer';
    }
  };

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-2">Digital Signature</h3>
        <p className="text-sm text-gray-600">
          {getRoleDisplayName()} Signature: {signerName}
        </p>
        {disabled && (
          <p className="text-sm text-amber-600 mt-2">
            This signature pad is currently disabled.
          </p>
        )}
      </div>

      <div className="mb-4">
        <Label className="block mb-2">
          Please sign in the area below:
        </Label>
        <div className="border-2 border-gray-300 rounded-lg overflow-hidden">
          <canvas
            ref={canvasRef}
            className={`block cursor-crosshair ${disabled ? 'opacity-50' : ''}`}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            style={{ touchAction: 'none' }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Use your mouse or touch screen to sign above
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={clearSignature}
          variant="outline"
          disabled={disabled || !signatureExists}
        >
          Clear
        </Button>
        <Button
          onClick={submitSignature}
          disabled={disabled || !signatureExists || isSigning}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isSigning ? 'Signing...' : 'Submit Signature'}
        </Button>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <p>
          By signing above, I acknowledge that I have read and agree to all terms and conditions
          of this purchase agreement. This electronic signature has the same legal effect as a
          handwritten signature.
        </p>
        <p className="mt-2">
          Date: {new Date().toLocaleDateString()}<br />
          Time: {new Date().toLocaleTimeString()}
        </p>
      </div>
    </Card>
  );
}