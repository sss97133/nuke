import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import UserPhotoAlbum from '../components/UserPhotoAlbum';
import RapidCameraCapture from '../components/mobile/RapidCameraCapture';
import '../design-system.css';

const MyAlbum: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);

  useEffect(() => {
    // Check if mobile
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handlePhotoSelect = (photo: any) => {
    if (isMobile) {
      // On mobile, show quick actions
      setSelectedPhoto(photo);
      setShowVehicleSelector(true);
    }
  };

  if (!user) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div className="window" style={{ width: '300px' }}>
          <div className="title-bar">
            <div className="title-bar-text">Authentication Required</div>
          </div>
          <div className="window-body">
            <p>Please log in to view your photo album.</p>
            <button onClick={() => navigate('/login')}>Log In</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: '#008080',
      padding: isMobile ? '0' : '20px'
    }}>
      {/* Mobile Header */}
      {isMobile && (
        <div style={{
          background: '#000080',
          color: 'white',
          padding: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}>
          <button 
            onClick={() => navigate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              cursor: 'pointer'
            }}
          >
            ←
          </button>
          <h1 style={{ 
            fontSize: '16px', 
            margin: 0,
            fontFamily: '"MS Sans Serif", sans-serif' 
          }}>
            My Photo Album
          </h1>
          <button 
            onClick={() => navigate('/vehicles')}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              cursor: 'pointer'
            }}
          >
            🚗
          </button>
        </div>
      )}

      {/* Main Content */}
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto',
        padding: isMobile ? '8px' : '0'
      }}>
        <UserPhotoAlbum 
          onPhotoSelect={handlePhotoSelect}
          allowOrganization={true}
        />
      </div>

      {/* Quick Vehicle Assignment Modal (Mobile) */}
      {isMobile && showVehicleSelector && selectedPhoto && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'white',
          borderTop: '2px solid #000',
          padding: '16px',
          zIndex: 1000
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>
            Assign Photo to Vehicle
          </h3>
          
          <div style={{ marginBottom: '12px' }}>
            <img 
              src={selectedPhoto.thumbnail_url || selectedPhoto.image_url}
              alt=""
              style={{ 
                width: '80px', 
                height: '80px', 
                objectFit: 'cover',
                border: '2px solid #c0c0c0'
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button 
              onClick={() => {
                navigate('/vehicles');
              }}
              style={{ flex: 1, minWidth: '120px' }}
            >
              Select Vehicle
            </button>
            <button 
              onClick={() => {
                navigate('/add-vehicle');
              }}
              style={{ flex: 1, minWidth: '120px' }}
            >
              New Vehicle
            </button>
            <button 
              onClick={() => {
                setShowVehicleSelector(false);
                setSelectedPhoto(null);
              }}
              style={{ flex: 1, minWidth: '120px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Floating Camera Button */}
      {isMobile && <RapidCameraCapture />}
    </div>
  );
};

export default MyAlbum;