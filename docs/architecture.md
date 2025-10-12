# System Architecture

## Overview

The Nuke platform implements a vehicle-centric architecture designed for scalability, performance, and maintainability. The system follows modern distributed design patterns with clear separation between presentation, business logic, and data layers.

## System Architecture

### High-Level Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React SPA     │    │  Phoenix API    │    │   PostgreSQL    │
│   (Frontend)    │◄──►│   (Backend)     │◄──►│   (Database)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         └──────────────►│   Supabase      │◄─────────────┘
                        │   (Auth/RT)     │
                        └─────────────────┘
```

### Frontend Architecture

#### Component Hierarchy
- **Pages**: Route-level components handling full-screen views
- **Components**: Reusable UI elements with specific functionality
- **Services**: Data access and business logic abstraction
- **Hooks**: Shared state management and lifecycle logic
- **Utils**: Pure functions and helper utilities

#### State Management
- **Local State**: Component-level state using React hooks
- **Shared State**: Custom hooks for cross-component data
- **Server State**: Supabase real-time subscriptions
- **Cache Management**: Strategic caching for performance optimization

### Backend Architecture

#### Phoenix Application Structure
- **Controllers**: HTTP request handling and response formatting
- **Contexts**: Business logic encapsulation and data access
- **Schemas**: Database model definitions and validation
- **LiveView**: Real-time interface components (optional)

#### Data Layer
- **Primary Database**: PostgreSQL with JSONB support
- **Authentication**: Supabase Auth integration
- **File Storage**: Supabase Storage for media assets
- **Real-time**: Phoenix PubSub with Supabase channels

## Component Architecture Patterns

### Modular Component Design

The system implements a modular component architecture demonstrated by the VehicleImageViewer refactoring:

**Before (Monolithic):**
- Single 1,058-line component
- Mixed concerns and responsibilities
- Difficult to test and maintain

**After (Modular):**
```
VehicleImageViewer (264 lines)
├── useImageViewerState (185 lines)    # State management
├── ImageGrid (168 lines)              # Display logic
├── ImageFilters (124 lines)           # Filter interface
└── ImageUploader (124 lines)          # Upload functionality
```

**Benefits:**
- 75% reduction in main component complexity
- Single responsibility principle adherence
- Enhanced testability and reusability
- Improved development velocity

### Service Layer Architecture

#### Image Processing Pipeline
```
File Upload → Validation → EXIF Extraction → Variant Generation → Storage → Database
```

**Components:**
- **ImageUploadService**: File handling and persistence
- **ImageOptimizationService**: Multi-resolution processing
- **ImageMetadata**: EXIF data extraction and processing

#### Performance Optimizations
- **Multi-resolution variants**: 300x improvement in thumbnail loading
- **Lazy loading**: Off-screen image deferral
- **Strategic caching**: Frequently accessed data optimization
- **Bundle splitting**: Optimal JavaScript loading

## Database Architecture

### Core Tables

#### Vehicles
Primary entity containing vehicle identification and metadata:
```sql
CREATE TABLE vehicles (
    id UUID PRIMARY KEY,
    vin VARCHAR(17) UNIQUE,
    make VARCHAR(50),
    model VARCHAR(100),
    year INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### Timeline Events
Immutable historical records:
```sql
CREATE TABLE timeline_events (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    event_type VARCHAR(50),
    event_date TIMESTAMP,
    created_by UUID,
    confidence_score DECIMAL(3,2)
);
```

#### Vehicle Images
Multi-resolution image storage:
```sql
CREATE TABLE vehicle_images (
    id UUID PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id),
    image_url TEXT NOT NULL,
    variants JSONB DEFAULT '{}',
    exif_data JSONB DEFAULT '{}',
    taken_at TIMESTAMP
);
```

### Indexing Strategy
- **Primary Keys**: UUID v4 for distributed scalability
- **Foreign Keys**: Optimized joins with proper indexing
- **JSONB Fields**: GIN indexes for efficient document queries
- **Temporal Data**: B-tree indexes on timestamp columns

## Security Architecture

### Authentication Flow
1. User authentication via Supabase Auth
2. JWT token validation in Phoenix middleware
3. Row Level Security policy enforcement
4. API endpoint authorization checks

### Data Protection
- **Input Validation**: Comprehensive sanitization at API boundaries
- **SQL Injection Prevention**: Parameterized queries and Ecto validation
- **File Upload Security**: Type validation and content scanning
- **Rate Limiting**: API endpoint protection against abuse

## Performance Characteristics

### Frontend Performance
- **First Contentful Paint**: <2 seconds on 3G connections
- **Time to Interactive**: <3 seconds for critical user paths
- **Image Loading**: 300x improvement with variant optimization
- **Bundle Size**: Optimized with code splitting and tree shaking

### Backend Performance
- **Response Time**: <100ms for 95th percentile API requests
- **Database Queries**: Optimized with proper indexing and query patterns
- **Concurrent Users**: Designed for 1000+ simultaneous connections
- **Memory Usage**: Efficient Elixir process management

## Scalability Considerations

### Horizontal Scaling
- **Stateless API**: Enables horizontal scaling of Phoenix instances
- **Database Scaling**: PostgreSQL read replicas for query distribution
- **CDN Integration**: Global asset distribution for image delivery
- **Cache Layers**: Redis integration for session and data caching

### Vertical Optimization
- **Elixir Concurrency**: Actor model for efficient resource utilization
- **Database Optimization**: Query performance monitoring and optimization
- **Asset Optimization**: Image compression and format optimization
- **Code Optimization**: Regular performance profiling and improvement

## Deployment Architecture

### Development Environment
- **Local Development**: Phoenix and React development servers
- **Database**: Local PostgreSQL or Supabase cloud instance
- **Hot Reloading**: Real-time code updates during development

### Production Environment
- **API Deployment**: Phoenix release with environment configuration
- **Frontend Deployment**: Static asset hosting with CDN
- **Database**: Managed PostgreSQL with backup and monitoring
- **Monitoring**: Application performance monitoring and alerting