import React from 'react';

export const TestSimple: React.FC = () => {
  const vehicleId = '7b07531f-e73a-4adb-b52c-d45922063edf';

  return (
    <div style={{
      padding: '20px',
      backgroundColor: 'var(--surface)',
      minHeight: '100vh'
    }}>
      <h1>Simple Image Test</h1>
      <p>Vehicle ID: {vehicleId}</p>

      <div style={{
        marginTop: '20px',
        padding: '20px',
        border: '1px solid #ccc',
        borderRadius: '8px'
      }}>
        <h2>Test 1: Basic Images</h2>
        <div>
          <img
            src="https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/vehicles/7b07531f-e73a-4adb-b52c-d45922063edf/images/1758510786695_5e5ild.jpeg"
            alt="Test image"
            style={{ maxWidth: '200px', height: 'auto', cursor: 'pointer' }}
            onClick={() => alert('Image clicked! This should work.')}
          />
        </div>
      </div>

      <div style={{
        marginTop: '20px',
        padding: '20px',
        border: '1px solid #ccc',
        borderRadius: '8px'
      }}>
        <h2>Test 2: Database Info</h2>
        <p>If this renders, React is working</p>
        <p>If the image loads, Supabase storage is working</p>
        <p>If the click works, JS events are working</p>
      </div>
    </div>
  );
};

export default TestSimple;