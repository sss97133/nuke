# Corporate Data Harvesting System Architecture

## System Overview

This is a comprehensive corporate data harvesting platform that transforms raw user-generated spatial tags into structured product intelligence for enterprise clients. The system combines crowd-sourced data collection with AI-powered analysis and multi-level verification workflows to create valuable datasets for companies like Snap-on Tools, Milwaukee Electric, and other industrial/consumer brands.

## Core Architecture

### Data Collection Layer
- **Frontend**: React/TypeScript application with spatial tagging interface
- **Tagging Engine**: Percentage-based coordinate system for precise product/damage identification
- **User Authentication**: Supabase Auth with JWT tokens
- **Real-time Updates**: Live tag synchronization with immediate visual feedback

### Backend Services
- **API Server**: Phoenix/Elixir framework providing RESTful endpoints
- **Database**: PostgreSQL with hybrid relational/JSONB storage
- **Authentication**: Custom AuthPlug with Supabase JWT verification
- **CORS**: Multi-origin support for development environments

### Database Schema

#### Primary Tables
- `vehicles` - Core vehicle records with comprehensive metadata
- `vehicle_images` - Image storage with optimization tracking and spatial_tags JSONB field
- `image_tags` - Relational storage for structured tag data with verification workflow
- `vehicle_timeline` - Event tracking and lifecycle management
- `vehicle_documents` - Document management and categorization

#### Hybrid Storage Approach
- **Relational Tags** (`image_tags` table): Structured data for reporting, analytics, and verification workflows
- **JSONB Tags** (`spatial_tags` field): Flexible storage for rapid prototyping and complex nested data

## Spatial Tagging System

### Tag Types and Categories
```elixir
@tag_types ["product", "damage", "location", "modification", "brand", "part", "tool", "fluid"]
```

- **Product Tags**: Parts, tools, or products visible in images
- **Damage Tags**: Visible damage, wear, or deterioration
- **Location Tags**: Geographic or spatial context markers
- **Modification Tags**: Aftermarket additions or changes
- **Brand Tags**: Brand identification and recognition
- **Part Tags**: Specific vehicle parts or components
- **Tool Tags**: Tools visible in workspace/repair scenarios
- **Fluid Tags**: Oils, coolants, or other automotive fluids

### Coordinate System
- **Format**: Percentage-based positioning (0-100% x/y coordinates)
- **Precision**: Float values for sub-pixel accuracy
- **Viewport Independence**: Coordinates work across all screen sizes
- **Drag-and-Drop**: Visual repositioning with real-time coordinate updates

## Verification and Trust System

### Multi-Level Verification
```elixir
def verify_tag(tag, verifier_id, verification_type) do
  trust_increment = case verification_type do
    "professional" -> 25    # Certified professionals
    "expert" -> 15         # Domain experts
    "peer" -> 10          # Community verification
    _ -> 5                # Basic verification
  end
end
```

### Trust Scoring
- **Initial Score**: 10 points for new tags
- **Maximum Score**: 100 points (fully verified)
- **Dispute Impact**: -15 points for disputed tags
- **Verification Boost**: Weighted by verifier expertise level

### Verification Statuses
- `pending` - Newly created, awaiting verification
- `verified` - Confirmed by professional/expert
- `peer_verified` - Community-verified
- `disputed` - Contested by other users
- `rejected` - Failed verification process

## Corporate Data Pipeline

### Raw Data Collection
1. **User Interaction**: Spatial tag creation on vehicle images
2. **Data Validation**: Schema validation and coordinate bounds checking
3. **Database Storage**: Dual storage in both relational and JSONB formats
4. **Real-time Sync**: Immediate frontend updates with loading states

### Data Processing Workflow
1. **Tag Aggregation**: Collect all tags for processing batches
2. **Brand Detection**: Fuzzy matching algorithms for brand identification
3. **Product Matching**: AI-powered product categorization and classification
4. **Quality Assessment**: Trust score calculation and verification status
5. **Corporate Assignment**: Route verified tags to relevant corporate clients

### Export and Analytics
- **AI Training Data**: COCO, YOLO, JSON, and CSV export formats
- **Corporate Reports**: Brand-specific analytics and trend analysis
- **Geographic Analytics**: Location-based product distribution mapping
- **Trust Metrics**: Verification quality and user expertise tracking

## API Architecture

### Public Endpoints (No Auth Required)
```
GET /api/vehicles          # Vehicle listing
GET /api/vehicles/:id      # Vehicle details
GET /api/images/:id        # Image metadata
GET /api/brands            # Brand catalog
GET /api/analytics/overview # Public analytics
```

### Protected Endpoints (Auth Required)
```
# Database Tag Management
POST /api/images/:id/db-tags      # Create structured tag
PUT  /api/images/:id/db-tags/:tag_id # Update tag
DELETE /api/images/:id/db-tags/:tag_id # Delete tag
POST /api/images/:id/db-tags/:tag_id/verify # Verify tag
POST /api/images/:id/db-tags/:tag_id/dispute # Dispute tag

# Brand Management
POST /api/brands/:id/claim        # Corporate brand claiming
POST /api/auto-detect-brands      # AI brand detection

# Analytics
GET /api/analytics/dashboard      # Admin analytics
GET /api/analytics/brands/:id     # Brand-specific metrics
```

## Frontend Component Architecture

### ProImageViewer Component
- **Spatial Tagging**: Click-to-tag with floating input forms
- **Tag Visualization**: Color-coded markers by tag type
- **Drag-and-Drop**: Real-time tag repositioning
- **Type Selector**: 8-category dropdown with descriptions
- **Mobile Support**: Responsive design with iOS keyboard handling

### Tag Management Panel
- **Tag List**: Comprehensive tag inventory with filtering
- **Verification UI**: One-click verification and dispute buttons
- **Trust Indicators**: Visual trust score representation
- **Batch Operations**: Multi-tag selection and processing

### Color-Coded System
```typescript
const getTagColor = (tagType?: string): string => {
  switch (tagType) {
    case 'product': return 'var(--success)';    // Green
    case 'damage': return 'var(--danger)';      // Red
    case 'brand': return 'var(--warning)';      // Orange
    case 'part': return 'var(--info)';          // Blue
    case 'tool': return 'var(--secondary)';     // Purple
    case 'fluid': return 'var(--primary)';      // Primary
    case 'location': return 'var(--dark)';      // Dark
    case 'modification': return 'var(--light)'; // Light
  }
};
```

## Admin Dashboard (Planned)

### Tag Processing Interface
- **Bulk Tag Review**: Process multiple tags simultaneously
- **Corporate Assignment**: Route verified tags to corporate clients
- **Quality Control**: Manual verification override capabilities
- **Analytics Dashboard**: Real-time metrics and trend analysis

### Brand Claiming Portal
- **Corporate Verification**: Verify corporate identity and ownership
- **Brand Catalog**: Comprehensive brand database management
- **Claim Processing**: Handle brand ownership disputes
- **API Access**: Corporate API keys and access management

### Data Export Tools
- **Format Selection**: COCO, YOLO, JSON, CSV export options
- **Filter Controls**: Date range, tag type, verification status filters
- **Batch Processing**: Large dataset export with progress tracking
- **Corporate Delivery**: Automated data delivery to verified clients

## Security Architecture

### Authentication Flow
1. **Frontend Login**: Supabase Auth integration
2. **JWT Token**: Secure token storage and transmission
3. **Backend Verification**: Custom AuthPlug validates tokens
4. **Row Level Security**: Database-level access control

### Data Protection
- **Input Validation**: Comprehensive parameter validation
- **SQL Injection Prevention**: Ecto query parameterization
- **CORS Policy**: Restricted origin access
- **Rate Limiting**: API endpoint protection (planned)

### Corporate Data Security
- **Brand Claiming Verification**: Multi-step corporate identity validation
- **API Key Management**: Secure access tokens for corporate clients
- **Data Segregation**: Isolated data streams per corporate client
- **Audit Trail**: Comprehensive logging of all data access

## Integration Points

### AI/ML Integration
- **Claude API**: Image analysis and product identification
- **Brand Detection**: Fuzzy matching for brand recognition
- **Quality Assessment**: Automated trust score calculation
- **Pattern Recognition**: Trend analysis and anomaly detection

### Corporate Integrations (Planned)
- **Snap-on Tools**: Tool identification and inventory management
- **Milwaukee Electric**: Power tool recognition and usage analytics
- **Generic Brand APIs**: Standardized integration framework
- **ERP Connections**: Direct integration with corporate systems

## Deployment Architecture

### Development Environment
- **Frontend**: React dev server on port 5173
- **Backend**: Phoenix server on port 4000
- **Database**: Supabase PostgreSQL instance
- **File Storage**: Supabase Storage for image assets

### Production Considerations (Planned)
- **Load Balancing**: Multi-instance backend deployment
- **CDN Integration**: Image delivery optimization
- **Database Scaling**: Read replicas and connection pooling
- **Monitoring**: Application performance and error tracking

## Performance Optimization

### Frontend Optimizations
- **Lazy Loading**: Deferred component initialization
- **Image Optimization**: Multiple resolution variants
- **State Management**: Efficient React state updates
- **Mobile Performance**: iOS-specific optimizations

### Backend Optimizations
- **Database Indexing**: Strategic index placement for query performance
- **Connection Pooling**: PostgreSQL connection management
- **Query Optimization**: Ecto query tuning and N+1 prevention
- **Caching**: Strategic data caching (planned)

## Monitoring and Analytics

### System Metrics
- **API Performance**: Response time and error rate tracking
- **Database Performance**: Query performance and connection monitoring
- **User Engagement**: Tag creation and verification rates
- **Data Quality**: Trust score distributions and verification patterns

### Business Intelligence
- **Corporate Analytics**: Brand-specific usage and trend reports
- **Geographic Distribution**: Location-based product analysis
- **User Behavior**: Tagging patterns and verification activity
- **Market Intelligence**: Competitive brand analysis

## Future Roadmap

### Phase 1: Core Stability
- [x] Database schema stabilization
- [x] Basic tagging functionality
- [x] Multi-level verification system
- [ ] Admin dashboard implementation
- [ ] Complete testing suite

### Phase 2: Corporate Integration
- [ ] Brand claiming portal
- [ ] Corporate API endpoints
- [ ] Automated data delivery
- [ ] Payment processing integration

### Phase 3: Advanced Features
- [ ] AI-powered auto-tagging
- [ ] Real-time collaboration
- [ ] Mobile applications
- [ ] Advanced analytics dashboard

### Phase 4: Scale and Enterprise
- [ ] Multi-tenant architecture
- [ ] Enterprise SSO integration
- [ ] Advanced security features
- [ ] Global deployment

## Technical Stack Summary

### Frontend
- **Framework**: React 18 with TypeScript
- **Styling**: CSS-in-JS with Windows 95 design system
- **State Management**: React hooks and context
- **HTTP Client**: Fetch API with custom error handling
- **Build Tool**: Vite for development and bundling

### Backend
- **Framework**: Phoenix 1.7 with Elixir
- **Database**: PostgreSQL with Ecto ORM
- **Authentication**: Supabase Auth with custom JWT validation
- **API**: RESTful endpoints with comprehensive CRUD operations
- **Real-time**: Phoenix Channels (ready for implementation)

### Infrastructure
- **Database**: Supabase PostgreSQL with Row Level Security
- **Authentication**: Supabase Auth with JWT tokens
- **File Storage**: Supabase Storage for images and documents
- **Development**: Local Phoenix server with hot reloading

This architecture provides a solid foundation for corporate data harvesting while maintaining flexibility for future enhancements and scale. The hybrid storage approach allows for both structured analytics and flexible data evolution, while the multi-level verification system ensures data quality for corporate clients.