import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '../contexts/ThemeContext';
import StorefrontLayout from './StorefrontLayout';
import StorefrontThemeWrapper from './StorefrontThemeWrapper';
import StorefrontHome from './pages/StorefrontHome';
import StorefrontInventory from './pages/StorefrontInventory';
import StorefrontVehicleDetail from './pages/StorefrontVehicleDetail';
import StorefrontAbout from './pages/StorefrontAbout';

export interface StorefrontOrg {
  id: string;
  business_name: string;
  slug: string;
  logo_url: string | null;
  banner_url: string | null;
  ui_config: any;
  description: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  business_type: string | null;
  social_links: any;
}

interface Props {
  organization: StorefrontOrg;
}

export default function StorefrontApp({ organization }: Props) {
  return (
    <ThemeProvider>
      <StorefrontThemeWrapper organization={organization}>
        <Router>
          <StorefrontLayout organization={organization}>
            <Routes>
              <Route path="/" element={<StorefrontHome organization={organization} />} />
              <Route path="/inventory" element={<StorefrontInventory organization={organization} />} />
              <Route path="/vehicles/:vehicleId" element={<StorefrontVehicleDetail organization={organization} />} />
              <Route path="/about" element={<StorefrontAbout organization={organization} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </StorefrontLayout>
        </Router>
      </StorefrontThemeWrapper>
    </ThemeProvider>
  );
}
