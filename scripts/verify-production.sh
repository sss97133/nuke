#!/bin/bash

# Verify production deployment is working

echo "🔍 Verifying Production Deployment"
echo "==================================="
echo ""

# Check common production URLs
URLS=(
    "https://nuke.vercel.app"
    "https://nukefrontend.vercel.app"
)

for URL in "${URLS[@]}"; do
    echo "Checking: $URL"
    echo "---"
    
    # Check HTTP status
    STATUS=$(curl -sI "$URL" 2>&1 | head -1 | grep -oE "HTTP/[0-9.]+ [0-9]+" | awk '{print $2}')
    
    if [ -z "$STATUS" ]; then
        echo "❌ Could not connect"
    elif [ "$STATUS" = "200" ]; then
        echo "✅ Status: $STATUS (OK)"
        
        # Check if it's actually serving content
        CONTENT=$(curl -s "$URL" 2>&1 | head -20)
        if echo "$CONTENT" | grep -qE "(root|React|<!DOCTYPE|html)"; then
            echo "✅ Serving content"
        else
            echo "⚠️  Response received but content unclear"
        fi
        
        # Check for common errors
        if echo "$CONTENT" | grep -qE "(404|error|Error|DEPLOYMENT_NOT_FOUND)"; then
            echo "❌ Error detected in response"
        fi
    elif [ "$STATUS" = "404" ]; then
        echo "❌ Status: $STATUS (Not Found)"
    else
        echo "⚠️  Status: $STATUS"
    fi
    
    echo ""
done

echo "📊 Production Verification Summary"
echo "=================================="
echo ""
echo "If status is 200: Production is live ✅"
echo "If status is 404: Deployment may have failed ❌"
echo "If cannot connect: Check Vercel dashboard"
echo ""
echo "🌐 Vercel Dashboard: https://vercel.com/dashboard"
echo ""

