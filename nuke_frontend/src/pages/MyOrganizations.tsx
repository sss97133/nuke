import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MyOrganizationsService, type MyOrganization } from '../services/myOrganizationsService';
import OrganizationCard from '../components/organization/OrganizationCard';
import { useAuth } from '../hooks/useAuth';
import '../styles/unified-design-system.css';