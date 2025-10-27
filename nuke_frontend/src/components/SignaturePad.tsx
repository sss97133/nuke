import React, { useRef, useState, useEffect } from 'react';

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  onClear?: () => void;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({ onSave, onClear }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile('ontouchstart' in window);
  }, []);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      // Touch event
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      // Mouse event
      x = e.nativeEvent.offsetX;
      y = e.nativeEvent.offsetY;
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setIsEmpty(false);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    let x, y;

    if ('touches' in e) {
      e.preventDefault();
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else {
      x = e.nativeEvent.offsetX;
      y = e.nativeEvent.offsetY;
    }

    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    onClear?.();
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <div style={{ 
      border: '2px solid #000', 
      borderRadius: '0px',
      display: 'inline-block',
      background: '#fff'
    }}>
      <canvas
        ref={canvasRef}
        width={500}
        height={200}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        style={{ 
          cursor: isDrawing ? 'crosshair' : 'default',
          display: 'block',
          touchAction: 'none'
        }}
      />
      <div style={{ 
        padding: '12px', 
        background: 'var(--surface-light, #f5f5f5)',
        borderTop: '2px solid #000',
        display: 'flex',
        gap: '8px',
        justifyContent: 'space-between'
      }}>
        <button
          onClick={clearCanvas}
          disabled={isEmpty}
          style={{
            padding: '8px 16px',
            border: '2px solid var(--text)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '9pt',
            fontWeight: 700,
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            borderRadius: '0px',
            opacity: isEmpty ? 0.5 : 1
          }}
        >
          Clear
        </button>
        <button
          onClick={saveSignature}
          disabled={isEmpty}
          style={{
            padding: '8px 24px',
            border: '2px solid var(--text)',
            background: isEmpty ? 'var(--surface)' : 'var(--text)',
            color: isEmpty ? 'var(--text)' : 'var(--surface)',
            fontSize: '9pt',
            fontWeight: 700,
            cursor: isEmpty ? 'not-allowed' : 'pointer',
            borderRadius: '0px'
          }}
        >
          Sign & Submit
        </button>
      </div>
      {isMobile && (
        <div style={{ 
          padding: '8px', 
          fontSize: '8pt', 
          color: '#666',
          textAlign: 'center',
          borderTop: '1px solid #ccc'
        }}>
          Sign with your finger above
        </div>
      )}
    </div>
  );
};

export default SignaturePad;

