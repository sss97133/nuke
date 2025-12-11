# 🚀 AWS Rekognition Deployment Instructions

## ✅ What's Been Completed

1. **Edge Function Updated** (`supabase/functions/scrape-vehicle/index.ts`)
   - Server-side image downloading (no CORS errors)
   - AWS Rekognition integration (label + text detection)
   - S3 upload for permanent storage
   - Returns processed_images with AI analysis

2. **Frontend Updated**
   - Desktop component consumes processed_images
   - Mobile component consumes processed_images
   - Logs Rekognition results to console
   - Build successful (no errors)

3. **Code Pushed to Production**
   - Commit: `16de1c5d`
   - Branch: `main`
   - Vercel will auto-deploy frontend

## ⚠️ Missing: AWS Credentials

The edge function will fail until AWS credentials are configured. You need:

1. **AWS Access Keys** with permissions for:
   - S3: `s3:PutObject` on bucket `nuke-vehicle-images`
   - Rekognition: `rekognition:DetectLabels`, `rekognition:DetectText`

2. **S3 Bucket** (if not exists):
   ```bash
   aws s3 mb s3://nuke-vehicle-images --region us-east-1
   ```

3. **Bucket Policy** (public read for CDN):
   ```bash
   aws s3api put-public-access-block \
     --bucket nuke-vehicle-images \
     --public-access-block-configuration \
     "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
   
   aws s3api put-bucket-policy --bucket nuke-vehicle-images --policy '{
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::nuke-vehicle-images/*"
       }
     ]
   }'
   ```

## 🔧 Deployment Steps

### Option 1: Automated (Recommended)

```bash
# Set your AWS credentials
export AWS_ACCESS_KEY_ID='your-access-key-id'
export AWS_SECRET_ACCESS_KEY='your-secret-access-key'
export AWS_REGION='us-east-1'
export AWS_S3_BUCKET='nuke-vehicle-images'

# Run deployment script
./deploy-with-rekognition.sh
```

This script will:
1. Check for AWS credentials
2. Set secrets in Supabase
3. Deploy the edge function
4. Show test command

### Option 2: Manual

```bash
# Set secrets in Supabase
supabase secrets set AWS_ACCESS_KEY_ID='your-key' --project-ref qkgaybvrernstplzjaam
supabase secrets set AWS_SECRET_ACCESS_KEY='your-secret' --project-ref qkgaybvrernstplzjaam
supabase secrets set AWS_REGION='us-east-1' --project-ref qkgaybvrernstplzjaam
supabase secrets set AWS_S3_BUCKET='nuke-vehicle-images' --project-ref qkgaybvrernstplzjaam

# Deploy edge function
supabase functions deploy scrape-vehicle --project-ref qkgaybvrernstplzjaam --no-verify-jwt
```

## 🧪 Testing After Deployment

### 1. Test Edge Function

```bash
curl -X POST 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle' \
  -H 'Authorization: Bearer <your-supabase-key>' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://sandiego.craigslist.org/esd/cto/d/el-centro-1972-gmc-suburban/7888155474.html"}'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "make": "GMC",
    "model": "Suburban",
    "year": "1972",
    "processed_images": [
      {
        "original_url": "https://images.craigslist.org/...",
        "s3_url": "https://nuke-vehicle-images.s3.amazonaws.com/scraped/craigslist/...",
        "analysis": {
          "labels": [
            {"name": "Car", "confidence": 99.5},
            {"name": "Vehicle", "confidence": 99.2}
          ],
          "text": [
            {"text": "GMC", "confidence": 99.8}
          ]
        }
      }
    ],
    "image_count": 10
  }
}
```

### 2. Test Frontend

1. Go to https://n-zero.dev/add-vehicle
2. Paste URL: `https://sandiego.craigslist.org/esd/cto/d/el-centro-1972-gmc-suburban/7888155474.html`
3. Open browser console (F12)
4. Look for:
   ```
   Found 10 processed images with Rekognition analysis
   Image 1 - Labels: Car, Vehicle, Automobile, Wheel, Tire
   Image 1 - Text detected: GMC, 1972
   Successfully processed 10/10 images with AI analysis
   ```
5. Verify success message: "✓ Data imported! 10 images analyzed with AWS Rekognition"
6. Check that images appear in upload queue

### 3. Verify S3 Upload

```bash
aws s3 ls s3://nuke-vehicle-images/scraped/craigslist/ --recursive
```

You should see uploaded images with timestamps.

## 💰 Cost Monitoring

### Rekognition Pricing
- Label Detection: $1.00 per 1,000 images
- Text Detection: $1.50 per 1,000 images
- **Total: $2.50 per 1,000 images**

### S3 Storage
- $0.023 per GB/month
- 10MB per image average
- **10GB = $0.23/month**

### Example Monthly Cost
- 100 vehicle imports
- 10 images each = 1,000 images
- **Rekognition: $2.50**
- **S3: $0.23**
- **Total: $2.73/month**

## 🔍 Troubleshooting

### Edge Function Errors

**"Missing AWS credentials"**
- Run `supabase secrets list --project-ref qkgaybvrernstplzjaam`
- Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set
- Redeploy function after setting secrets

**"S3 upload failed"**
- Check bucket exists: `aws s3 ls s3://nuke-vehicle-images`
- Verify IAM permissions: `s3:PutObject`
- Check bucket policy allows writes

**"Rekognition analysis failed"**
- Verify IAM permissions: `rekognition:DetectLabels`, `rekognition:DetectText`
- Check region matches (default: us-east-1)
- Verify Rekognition service is available in your region

**"Image download timeout"**
- Normal for slow connections
- Function continues with other images
- Check edge function logs: `supabase functions logs scrape-vehicle`

### Frontend Issues

**"No images processed"**
- Check edge function response in Network tab
- Verify `processed_images` array exists
- Check for S3 CORS errors (bucket should have public read)

**"Image fetch failed"**
- Verify S3 bucket policy allows public read
- Check S3 URLs are accessible: `curl -I https://nuke-vehicle-images.s3.amazonaws.com/...`

## 📊 Monitoring

### CloudWatch Metrics (AWS Console)

1. **Rekognition**:
   - Go to CloudWatch > Metrics > Rekognition
   - Monitor: `UserErrorCount`, `SystemErrorCount`, `CallCount`

2. **S3**:
   - Go to S3 > Metrics > Storage
   - Monitor: `BucketSize`, `NumberOfObjects`

### Supabase Logs

```bash
# Watch edge function logs in real-time
supabase functions logs scrape-vehicle --project-ref qkgaybvrernstplzjaam --follow

# Filter for errors
supabase functions logs scrape-vehicle --project-ref qkgaybvrernstplzjaam | grep ERROR
```

## 🎯 Next Steps

After deployment:
1. ✅ Test with multiple Craigslist listings
2. ✅ Verify Rekognition labels are useful
3. ✅ Check S3 storage accumulation
4. ✅ Monitor AWS costs (set budget alerts)
5. ⏭️ Save Rekognition data to database for search
6. ⏭️ Build image search by detected labels
7. ⏭️ Auto-extract VIN from text detection

## 📞 Support

If you encounter issues:
1. Check edge function logs
2. Verify AWS credentials and permissions
3. Test S3 bucket accessibility
4. Review CloudWatch metrics

For code issues, see:
- `AWS_REKOGNITION_SETUP.md` - Full technical documentation
- `supabase/functions/scrape-vehicle/index.ts` - Edge function code
- `nuke_frontend/src/pages/add-vehicle/AddVehicle.tsx` - Frontend integration

