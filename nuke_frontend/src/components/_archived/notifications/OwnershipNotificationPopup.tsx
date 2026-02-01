import { useState, useEffect } from 'react';
import '../../design-system.css';

interface OwnershipNotificationPopupProps {
  type: 'success' | 'duplicate' | 'error';
  message: string;
  details?: string;
  onClose: () => void;
  autoClose?: number; // milliseconds
}

const OwnershipNotificationPopup = ({
  type,
  message,
  details,
  onClose,
  autoClose = 5000
}: OwnershipNotificationPopupProps) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (autoClose > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onClose, 300); // Allow fade out animation
      }, autoClose);

      return () => clearTimeout(timer);
    }
  }, [autoClose, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success': return '✅';
      case 'duplicate': return 'Pending';
      case 'error': return '❌';
      default: return 'ℹ️';
    }
  };

  const getBackgroundColor = () => {
    switch (type) {
      case 'success': return '#e8f5e8';
      case 'duplicate': return '#fff3cd';
      case 'error': return '#f8d7da';
      default: return '#e7f3ff';
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'success': return '#c8e6c8';
      case 'duplicate': return '#ffeaa7';
      case 'error': return '#f5c6cb';
      default: return '#b8daff';
    }
  };

  const getTextColor = () => {
    switch (type) {
      case 'success': return '#166534';
      case 'duplicate': return '#856404';
      case 'error': return '#721c24';
      default: return '#0c4a6e';
    }
  };

  if (!visible) return null;

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        onClick={() => {
          setVisible(false);
          setTimeout(onClose, 300);
        }}
      >
        {/* Popup */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: getBackgroundColor(),
            border: `2px solid ${getBorderColor()}`,
            borderRadius: '0px',
            padding: '16px',
            fontFamily: 'Arial, sans-serif',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '4px 4px 0px rgba(0, 0, 0, 0.2)',
            animation: visible ? 'slideIn 0.3s ease-out' : 'slideOut 0.3s ease-in'
          }}
        >
          {/* Header with Icon and Close Button */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '14pt' }}>{getIcon()}</span>
              <div style={{
                fontSize: '8pt',
                fontWeight: 'bold',
                color: getTextColor()
              }}>
                {type === 'success' ? 'Documentation Submitted' :
                 type === 'duplicate' ? 'Already Submitted' :
                 type === 'error' ? 'Submission Failed' : 'Notification'}
              </div>
            </div>

            <button
              onClick={() => {
                setVisible(false);
                setTimeout(onClose, 300);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '12pt',
                cursor: 'pointer',
                color: getTextColor(),
                padding: '0px 4px'
              }}
            >
              ×
            </button>
          </div>

          {/* Main Message */}
          <div style={{
            fontSize: '8pt',
            color: getTextColor(),
            marginBottom: details ? '8px' : '0px',
            lineHeight: '1.4'
          }}>
            {message}
          </div>

          {/* Details */}
          {details && (
            <div style={{
              fontSize: '7pt',
              color: getTextColor(),
              opacity: 0.8,
              marginBottom: '12px',
              lineHeight: '1.3'
            }}>
              {details}
            </div>
          )}

          {/* Status Message */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.5)',
            border: `1px solid ${getBorderColor()}`,
            padding: '8px',
            fontSize: '8pt',
            color: getTextColor(),
            fontWeight: 'bold',
            textAlign: 'center'
          }}>
            {type === 'success' && 'Awaiting Admin Approval'}
            {type === 'duplicate' && 'Awaiting Admin Approval'}
            {type === 'error' && 'Please Try Again Later'}
          </div>

          {/* Action Buttons */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '12px'
          }}>
            <button
              onClick={() => {
                setVisible(false);
                setTimeout(onClose, 300);
              }}
              style={{
                background: '#424242',
                color: 'white',
                border: '1px solid #bdbdbd',
                borderRadius: '0px',
                padding: '6px 12px',
                fontSize: '8pt',
                cursor: 'pointer',
                fontFamily: 'Arial, sans-serif'
              }}
            >
              OK
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        @keyframes slideOut {
          from {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          to {
            opacity: 0;
            transform: scale(0.9) translateY(-20px);
          }
        }
      `}</style>
    </>
  );
};

export default OwnershipNotificationPopup;