# Profile Pipeline & Page System

## Overview

The Profile Pipeline is a comprehensive system that tracks user progress, achievements, and activity within the Nuke Platform. It provides a complete user experience from onboarding through advanced community participation.

## Database Schema

### Core Tables

#### 1. `profiles` (Existing)
- **Purpose**: Core user profile information
- **Key Fields**: `id`, `username`, `full_name`, `avatar_url`, `bio`, `user_type`, `reputation_score`
- **Relationships**: Links to all other profile-related tables

#### 2. `profile_completion` (New)
- **Purpose**: Tracks profile completion progress
- **Key Fields**:
  - `user_id`: References profiles(id)
  - `basic_info_complete`: Boolean for basic profile info
  - `avatar_uploaded`: Boolean for avatar upload
  - `bio_added`: Boolean for bio completion
  - `social_links_added`: Boolean for social links
  - `first_vehicle_added`: Boolean for first vehicle
  - `skills_added`: Boolean for skills section
  - `location_added`: Boolean for location info
  - `total_completion_percentage`: Calculated completion percentage
  - `last_updated`: Timestamp of last update

#### 3. `profile_achievements` (New)
- **Purpose**: Gamification system for user engagement
- **Key Fields**:
  - `user_id`: References profiles(id)
  - `achievement_type`: Type of achievement ('first_vehicle', 'profile_complete', etc.)
  - `achievement_title`: Display title
  - `achievement_description`: Detailed description
  - `earned_at`: When achievement was earned
  - `icon_url`: Optional icon for achievement
  - `points_awarded`: Points given for achievement

#### 4. `profile_activity` (New)
- **Purpose**: Activity feed for user actions
- **Key Fields**:
  - `user_id`: References profiles(id)
  - `activity_type`: Type of activity ('vehicle_added', 'profile_updated', etc.)
  - `activity_title`: Display title
  - `activity_description`: Detailed description
  - `related_vehicle_id`: Optional link to vehicle
  - `related_achievement_id`: Optional link to achievement
  - `created_at`: When activity occurred

#### 5. `profile_stats` (New)
- **Purpose**: Aggregated statistics for user profile
- **Key Fields**:
  - `user_id`: References profiles(id)
  - `total_vehicles`: Count of user vehicles
  - `total_images`: Count of user images
  - `total_contributions`: Count of contributions
  - `profile_views`: Count of profile views
  - `followers_count`: Number of followers
  - `following_count`: Number of following
  - `last_activity`: Last activity timestamp
  - `updated_at`: Last stats update

### Supporting Tables (Existing)
- `vehicles`: User's vehicle collection
- `vehicle_images`: Images uploaded by user
- `user_reputation`: Reputation scoring system
- `user_contributions`: Contribution tracking

## Features

### 1. Profile Completion Tracking
- **Automatic Calculation**: Triggers automatically update completion percentage
- **Visual Progress**: Shows completion percentage in profile
- **Guided Onboarding**: Helps users complete their profile step-by-step

### 2. Achievement System
- **Default Achievements**:
  - First Vehicle (10 points)
  - Profile Complete (25 points)
  - First Image (5 points)
  - Contributor (15 points)
  - Vehicle Collector (20 points)
  - Image Enthusiast (15 points)
  - Community Member (10 points)
  - Verified User (5 points)

- **Automatic Awarding**: Achievements are awarded automatically based on user actions
- **Points System**: Each achievement awards points for reputation building

### 3. Activity Feed
- **Real-time Updates**: Activities are logged automatically
- **Rich Content**: Links to related vehicles and achievements
- **Public/Private**: Activities can be viewed publicly or privately

### 4. Statistics Tracking
- **Automatic Updates**: Stats update automatically via triggers
- **Performance Metrics**: Track user engagement and contribution
- **Social Metrics**: Followers, following, and profile views

## Profile Page Design

### Layout Structure
```
Profile Page
├── Header
│   ├── Navigation
│   └── User Info
├── Profile Header
│   ├── Avatar
│   ├── Basic Info (Name, Username, Bio)
│   ├── Stats Grid (Vehicles, Images, Contributions, etc.)
│   └── Action Buttons (Edit Profile, Add Vehicle)
├── Tab Navigation
│   ├── Overview
│   ├── Vehicles
│   ├── Achievements
│   ├── Activity
│   └── Settings (if own profile)
└── Tab Content
    ├── Overview: Recent Activity, Achievements, Profile Info
    ├── Vehicles: Vehicle Collection Grid
    ├── Achievements: Achievement Gallery
    ├── Activity: Activity Feed
    └── Settings: Profile Settings
```

### Design System Integration
- **Classic Design**: Uses Windows 95/macOS 10 aesthetic
- **Typography**: 10px/12px Arial font
- **Colors**: Light grey/white backgrounds, black text
- **Spacing**: Tight spacing with minimal padding
- **Components**: Cards, buttons, tables, badges, status indicators

## Implementation Details

### Database Triggers
1. **Profile Completion Trigger**: Automatically calculates completion percentage
2. **Vehicle Stats Trigger**: Updates stats when vehicles are added/removed
3. **Image Stats Trigger**: Updates stats when images are added/removed

### Functions
1. **`award_achievement(user_uuid, achievement_type)`**: Awards achievements to users
2. **`update_profile_completion()`**: Updates completion percentage
3. **`update_profile_stats_on_vehicle_change()`**: Updates stats on vehicle changes
4. **`update_profile_stats_on_image_change()`**: Updates stats on image changes

### Row Level Security (RLS)
- **Private Data**: Users can only view/edit their own data
- **Public Data**: Achievements, activities, and stats are publicly readable
- **Admin Access**: Elevated users can manage all data

## User Experience Flow

### New User Journey
```
1. User Registration
   ↓
2. Profile Creation (Basic Info)
   ↓
3. Onboarding Steps
   ├── Avatar Upload
   ├── Bio Addition
   ├── Social Links
   ├── Skills Addition
   ├── Location Addition
   └── First Vehicle
   ↓
4. Achievement Unlocking
   ↓
5. Community Participation
```

### Profile Completion Tracking
```
Profile Completion = (Completed Fields / Total Fields) × 100

Fields:
- Basic Info Complete
- Avatar Uploaded
- Bio Added
- Social Links Added
- First Vehicle Added
- Skills Added
- Location Added
```

### Achievement System
```
Achievement Types:
├── First Vehicle (10 points)
├── Profile Complete (25 points)
├── First Image (5 points)
├── Contributor (15 points)
├── Vehicle Collector (20 points)
├── Image Enthusiast (15 points)
├── Community Member (10 points)
└── Verified User (5 points)
```

## API Endpoints

### Profile Data
- `GET /api/profile/:userId` - Get profile data
- `PUT /api/profile/:userId` - Update profile
- `GET /api/profile/:userId/stats` - Get profile stats
- `GET /api/profile/:userId/achievements` - Get achievements
- `GET /api/profile/:userId/activity` - Get activity feed

### Achievements
- `POST /api/achievements/award` - Award achievement
- `GET /api/achievements/available` - Get available achievements
- `GET /api/achievements/leaderboard` - Get achievement leaderboard

### Activity
- `GET /api/activity/:userId` - Get user activity
- `POST /api/activity` - Log new activity

## Future Enhancements

### Planned Features
1. **Social Features**:
   - Follow/Unfollow users
   - User recommendations
   - Community challenges

2. **Advanced Achievements**:
   - Seasonal achievements
   - Community-voted achievements
   - Custom achievement creation

3. **Analytics**:
   - Profile view analytics
   - Engagement metrics
   - Community impact scoring

4. **Gamification**:
   - Level system
   - Badge collections
   - Community rankings

### Technical Improvements
1. **Performance**:
   - Caching for frequently accessed data
   - Pagination for large datasets
   - Real-time updates via WebSockets

2. **Scalability**:
   - Database optimization
   - CDN for images
   - Microservices architecture

## Migration Instructions

### Database Migration
1. Run the migration file: `supabase/migrations/20250117_profile_enhancement_tables.sql`
2. Verify all tables are created correctly
3. Test RLS policies
4. Verify triggers and functions work

### Application Setup
1. Update environment variables for Supabase
2. Install required dependencies
3. Test profile page functionality
4. Verify achievement system works

### Testing
1. Test profile completion tracking
2. Test achievement awarding
3. Test activity logging
4. Test statistics updates
5. Test RLS policies

## Troubleshooting

### Common Issues
1. **Profile completion not updating**: Check trigger function
2. **Achievements not awarding**: Verify achievement types exist
3. **Stats not updating**: Check vehicle/image triggers
4. **RLS policy errors**: Verify user authentication

### Debug Commands
```sql
-- Check profile completion
SELECT * FROM profile_completion WHERE user_id = 'user-uuid';

-- Check achievements
SELECT * FROM profile_achievements WHERE user_id = 'user-uuid';

-- Check activity
SELECT * FROM profile_activity WHERE user_id = 'user-uuid' ORDER BY created_at DESC;

-- Check stats
SELECT * FROM profile_stats WHERE user_id = 'user-uuid';
```

## Conclusion

The Profile Pipeline provides a comprehensive system for user engagement, progress tracking, and community building. It integrates seamlessly with the existing vehicle management system while adding gamification and social features that encourage user participation and retention. 