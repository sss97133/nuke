#!/bin/bash

echo "🚀 Deploying scrape-vehicle function with AWS Rekognition..."
echo ""

# Check if AWS credentials are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "⚠️  AWS credentials not found in environment variables"
  echo ""
  echo "Please set the following environment variables:"
  echo "  export AWS_ACCESS_KEY_ID='your-access-key'"
  echo "  export AWS_SECRET_ACCESS_KEY='your-secret-key'"
  echo "  export AWS_REGION='us-east-1'  # optional, defaults to us-east-1"
  echo "  export AWS_S3_BUCKET='nuke-vehicle-images'  # optional"
  echo ""
  exit 1
fi

# Set AWS secrets in Supabase
echo "📝 Setting AWS secrets in Supabase..."
supabase secrets set AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" --project-ref qkgaybvrernstplzjaam
supabase secrets set AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" --project-ref qkgaybvrernstplzjaam
supabase secrets set AWS_REGION="${AWS_REGION:-us-east-1}" --project-ref qkgaybvrernstplzjaam
supabase secrets set AWS_S3_BUCKET="${AWS_S3_BUCKET:-nuke-vehicle-images}" --project-ref qkgaybvrernstplzjaam

echo ""
echo "🔄 Deploying edge function..."
supabase functions deploy scrape-vehicle --project-ref qkgaybvrernstplzjaam --no-verify-jwt

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🧪 Test with:"
echo "curl -X POST 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle' \\"
echo "  -H 'Authorization: Bearer YOUR_ANON_KEY' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"url\": \"https://sandiego.craigslist.org/esd/cto/d/el-centro-1972-gmc-suburban/7888155474.html\"}'"
echo ""

