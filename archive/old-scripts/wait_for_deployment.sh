#!/bin/bash
# Automated deployment verification - runs until components are live

echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║     WAITING FOR VERCEL DEPLOYMENT                                 ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Last push: $(git log -1 --format='%h - %s')"
echo "Checking every 30 seconds..."
echo ""

MAX_ATTEMPTS=20
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "Check #$ATTEMPT at $(date +%H:%M:%S)..."
  
  # Run verification
  if node verify_deployment.js 2>&1 | grep -q "DEPLOYMENT SUCCESSFUL"; then
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════════╗"
    echo "║     🎉 DEPLOYMENT COMPLETE!                                       ║"
    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "✅ All components are now LIVE on https://n-zero.dev"
    echo ""
    echo "Test it:"
    echo "  https://n-zero.dev/vehicle/79fe1a2b-9099-45b5-92c0-54e7f896089e"
    echo ""
    echo "You should see:"
    echo "  • Associated Organizations card"
    echo "  • Ernies Upholstery (97% GPS confidence)"
    echo "  • Viva! Las Vegas Autos"
    echo "  • Valuation Breakdown"
    echo ""
    exit 0
  fi
  
  if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
    echo "  Not ready yet, waiting 30s..."
    sleep 30
  fi
done

echo ""
echo "⚠️  Deployment verification timed out after $(($MAX_ATTEMPTS * 30 / 60)) minutes"
echo ""
echo "Next steps:"
echo "  1. Check Vercel dashboard: https://vercel.com"
echo "  2. Manually visit: https://n-zero.dev/vehicle/79fe1a2b-9099-45b5-92c0-54e7f896089e"
echo "  3. Hard refresh (Cmd+Shift+R)"
echo "  4. Check console for [LinkedOrganizations] logs"
echo ""

