import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase';
import { FaviconIcon } from '../components/common/FaviconIcon';
// Always loaded — used in the overview tab or global page structure
import OrganizationTimelineHeatmap from '../components/organization/OrganizationTimelineHeatmap';
import SoldInventoryBrowser from '../components/organization/SoldInventoryBrowser';
import { ServiceVehicleCardRich } from '../components/organization/ServiceVehicleCardRich';
import { extractImageMetadata } from '../utils/imageMetadata';
import { DynamicTabBar } from '../components/organization/DynamicTabBar';
import { OrganizationIntelligenceService, type OrganizationIntelligence, type TabConfig } from '../services/organizationIntelligenceService';
import VehicleThumbnail from '../components/VehicleThumbnail';
import { getOrganizationProfileData } from '../services/profileStatsService';
import { AdminNotificationService } from '../services/adminNotificationService';
import BroadArrowMetricsDisplay from '../components/organization/BroadArrowMetricsDisplay';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import '../styles/unified-design-system.css';
