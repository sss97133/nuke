
import { Routes, Route } from 'react-router-dom';

import AddVehiclePage from './pages/AddVehiclePage';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<div>Home Page</div>} />
        <Route path="/register" element={<div>Register Page</div>} />
        <Route path="/vehicles" element={<div>Vehicles List Page</div>} />
        <Route path="/add-vehicle" element={<AddVehiclePage />} />
      </Routes>
    </div>
  );
}

export default App;
