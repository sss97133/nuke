import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { readCachedSession } from '../utils/cachedSession';
import { useAuthContext } from '../contexts/AuthContext';
// AppLayout now provided globally by App.tsx
import GarageVehicleCard from '../components/vehicles/GarageVehicleCard';
import VehicleRelationshipManager from '../components/VehicleRelationshipManager';
import OrganizationContextFilter from '../components/vehicles/OrganizationContextFilter';
import BulkActionsToolbar from '../components/vehicles/BulkActionsToolbar';
import VehicleOrganizationToolbar from '../components/vehicles/VehicleOrganizationToolbar';
import VehicleConfirmationQuestions from '../components/vehicles/VehicleConfirmationQuestions';
import TitleTransferApproval from '../components/ownership/TitleTransferApproval';
import FleetHealthOverview from '../components/vehicles/FleetHealthOverview';
import QuickFixModal from '../components/vehicles/QuickFixModal';
import { MyOrganizationsService, type MyOrganization } from '../services/myOrganizationsService';
import { usePageTitle } from '../hooks/usePageTitle';
import '../styles/unified-design-system.css';