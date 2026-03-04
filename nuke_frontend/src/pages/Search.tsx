import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import IntelligentSearch from '../components/search/IntelligentSearch';
import SearchResults from '../components/search/SearchResults';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';