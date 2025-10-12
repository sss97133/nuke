# Dropbox Vehicle Import Integration Setup

This document provides complete setup instructions for the Dropbox vehicle inventory import system with AI-powered data extraction and human verification workflows.

## Overview

The Dropbox integration enables users to:
- Connect their Dropbox account via OAuth
- Select specific folders containing vehicle inventory
- Automatically import vehicle images and documents
- Extract vehicle data using AI (OpenAI Vision API)
- Review and approve AI extractions through a human verification interface
- Build trust scores through multi-source verification

## Prerequisites

### Required Environment Variables

Create a `.env` file in the `nuke_frontend` directory with the following variables:

```bash
# Dropbox OAuth Configuration
VITE_DROPBOX_CLIENT_ID=your_dropbox_app_key
VITE_DROPBOX_CLIENT_SECRET=your_dropbox_app_secret

# OpenAI API for vehicle data extraction
VITE_OPENAI_API_KEY=your_openai_api_key

# Optional: Personal access token for development (not recommended for production)
VITE_DROPBOX_ACCESS_TOKEN=your_personal_access_token
```

### Dropbox App Setup

1. **Create Dropbox App**
   - Go to https://www.dropbox.com/developers/apps
   - Click "Create app"
   - Choose "Scoped access"
   - Choose "Full Dropbox" access
   - Name your app (e.g., "Nuke Vehicle Import")

2. **Configure OAuth Settings**
   - Add redirect URI: `http://localhost:5173/dropbox-callback` (development)
   - Add redirect URI: `https://yourdomain.com/dropbox-callback` (production)
   - Enable the following scopes:
     - `files.metadata.read`
     - `files.content.read`
     - `account_info.read`

3. **Get App Credentials**
   - Copy the "App key" to `VITE_DROPBOX_CLIENT_ID`
   - Copy the "App secret" to `VITE_DROPBOX_CLIENT_SECRET`

### OpenAI API Setup

1. **Get API Key**
   - Go to https://platform.openai.com/api-keys
   - Create a new API key
   - Copy to `VITE_OPENAI_API_KEY`

2. **Enable Vision API**
   - Ensure your OpenAI account has access to GPT-4 Vision
   - Set up billing if required

## Database Setup

The integration requires several database tables. Run the following migrations:

```bash
# Apply vehicle verifications table
supabase db push --file supabase/migrations/20250817_vehicle_verifications_table.sql

# Apply vehicle approval tables
supabase db push --file supabase/migrations/20250817_vehicle_approval_tables.sql
```

### Required Tables

1. **vehicles** - Core vehicle data (should already exist)
2. **vehicle_verifications** - Human verification records
3. **vehicle_extractions** - AI-extracted data pending approval
4. **vehicle_approvals** - Approval decisions for extractions

## Usage Workflow

### 1. Dropbox Connection

1. Navigate to `/dropbox-import`
2. Click "Connect to Dropbox"
3. Choose between business or personal account
4. Complete OAuth authorization
5. Return to application with access token

### 2. Folder Selection

1. After successful connection, click "Select Vehicle Folder"
2. Choose from available Dropbox folders
3. System scans selected folder for vehicle subfolders and images

### 3. Vehicle Import

1. Review detected vehicle folders
2. Select folders to import
3. Click "Process Selected" to begin AI extraction
4. System processes images using OpenAI Vision API

### 4. Human Approval

1. Navigate to `/vehicle-approval/:extractionId` for pending extractions
2. Review AI-extracted data field by field
3. Approve, modify, or reject each field
4. Add approval notes
5. Submit approval to create vehicle record

### 5. Verification System

1. Navigate to `/vehicle-verification/:vehicleId` for existing vehicles
2. Verify specific data fields based on inspection method
3. Add verification notes and confidence scores
4. Build trust scores through multiple verifications

## File Structure

```
nuke_frontend/src/
├── pages/
│   ├── DropboxImport.tsx          # Main import interface
│   ├── DropboxCallback.tsx        # OAuth callback handler
│   ├── VehicleApproval.tsx        # AI extraction approval
│   └── VehicleVerification.tsx    # Human verification interface
├── services/
│   ├── dropboxService.ts          # Dropbox API integration
│   ├── vehicleImportPipeline.ts   # Import orchestration
│   └── verificationSystem.ts     # Trust scoring and badges
└── components/
    └── VerificationBadges.tsx     # Verification UI components
```

## Security Considerations

### OAuth Security
- Uses CSRF state tokens for OAuth flow
- Access tokens stored in localStorage (consider httpOnly cookies for production)
- Force account re-approval to handle multiple Dropbox accounts

### Data Privacy
- AI processing happens via OpenAI API (data sent to third party)
- Vehicle images temporarily processed for extraction
- All data stored in Supabase with Row Level Security (RLS)

### Access Control
- RLS policies ensure users only access their own data
- Verification system tracks who verified what data
- Audit trail for all approval decisions

## Troubleshooting

### Common Issues

1. **"Missing _subject_uid" OAuth Error**
   - Ensure using `response_type=token` in OAuth URL
   - Check redirect URI matches exactly in Dropbox app settings

2. **"Illegal invocation" Fetch Error**
   - Dropbox SDK fetch binding issue
   - Fixed by binding fetch to window: `fetch: window.fetch.bind(window)`

3. **Folder Not Found**
   - Use folder selection UI instead of hardcoded paths
   - Check folder permissions in Dropbox

4. **OpenAI API Errors**
   - Verify API key is valid and has Vision access
   - Check rate limits and billing status
   - Ensure images are accessible via public URLs

### Development Tips

1. **Testing OAuth Flow**
   - Use `force_reapprove=true` to test account switching
   - Clear localStorage to reset connection state

2. **Debugging Extractions**
   - Check browser console for API responses
   - Verify image URLs are accessible
   - Test with different image types and sizes

3. **Database Issues**
   - Ensure all migrations are applied
   - Check RLS policies for access issues
   - Verify foreign key relationships

## Production Deployment

### Environment Setup
- Set production Dropbox redirect URIs
- Use secure environment variable storage
- Enable HTTPS for OAuth callbacks

### Performance Optimization
- Implement image compression before AI processing
- Add caching for Dropbox folder listings
- Use background jobs for large imports

### Monitoring
- Track OAuth success/failure rates
- Monitor AI extraction accuracy
- Log verification system usage

## API Rate Limits

### Dropbox API
- 120 requests per minute per app
- Batch operations where possible
- Implement exponential backoff

### OpenAI API
- Varies by plan and model
- Monitor usage in OpenAI dashboard
- Implement queuing for large batches

## Support

For issues with this integration:
1. Check the troubleshooting section above
2. Review browser console for error messages
3. Verify all environment variables are set correctly
4. Ensure database migrations are applied

## Future Enhancements

- Batch processing for large inventories
- Support for additional file types (PDFs, documents)
- Integration with other cloud storage providers
- Advanced AI models for better extraction accuracy
- Real-time collaboration on verifications
