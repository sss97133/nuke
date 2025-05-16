#!/bin/bash

# Archive Nuke Codebase Script
# This script preserves essential files and archives the rest

# Create archive directory
mkdir -p archive/src

# Create directories for preserved code
mkdir -p clean-src/{components,components/auth,components/ui,lib,pages,pages/auth,providers,routes,stores,types,utils}

# STEP 1: PRESERVE ESSENTIAL FILES

# Auth components we just created
cp -r src/pages/auth/Auth.tsx clean-src/pages/auth/
cp -r src/pages/auth/AuthCallback.tsx clean-src/pages/auth/
cp -r src/pages/auth/AuthTest.tsx clean-src/pages/auth/
cp -r src/pages/auth/Profile.tsx clean-src/pages/auth/
cp -r src/pages/auth/ResetPassword.tsx clean-src/pages/auth/
cp -r src/pages/auth/TestAuth.tsx clean-src/pages/auth/

# Auth components
cp -r src/components/auth/ProtectedRoute.tsx clean-src/components/auth/
cp -r src/components/auth/SignOut.tsx clean-src/components/auth/
cp -r src/components/auth/UserAvatar.tsx clean-src/components/auth/

# Core infrastructure
cp -r src/lib/supabase-client.ts clean-src/lib/
cp -r src/providers/AuthProvider.tsx clean-src/providers/
cp -r src/routes/routeConfig.tsx clean-src/routes/
cp -r src/routes/AppRouter.tsx clean-src/routes/

# Core UI components (only main ones)
mkdir -p clean-src/components/ui
cp -r src/components/ui/{button,card,input,toast,avatar}.tsx clean-src/components/ui/ 2>/dev/null

# STEP 2: PRESERVE ESSENTIAL PROJECT FILES
cp package.json clean-src/
cp vite.config.ts clean-src/
cp tsconfig.json clean-src/
cp index.html clean-src/
cp .env.example clean-src/

# STEP 3: ARCHIVE EVERYTHING ELSE
cp -r src/* archive/src/

# STEP 4: REPLACE SRC WITH CLEAN VERSION
echo "Replacing src with clean version..."

# Uncomment these lines when ready to execute
# rm -rf src
# mv clean-src src

echo "Done! Original code is preserved in archive/src"
echo "Review the clean-src directory and when satisfied, uncomment the last two lines to finalize."
