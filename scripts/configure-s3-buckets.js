#!/usr/bin/env node

/**
 * Configure S3-compatible storage buckets for Supabase
 * Uses S3 credentials to set proper permissions
 */

import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env') });

// S3 Configuration
const s3Config = {
  accessKeyId: '6bd04f9857cbf16fddf175fe74ffa5f4',
  secretAccessKey: 'f7b2dd91ea42ec028fc42e60473e5caafb7be6745ab8ba4a0a95a02b0a21a616',
  endpoint: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/s3',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
  region: 'us-east-1' // Default region for Supabase
};

const s3 = new AWS.S3(s3Config);

async function configureBuckets() {
  console.log('🔧 Configuring S3 storage buckets...\n');

  try {
    // List existing buckets
    console.log('📦 Listing buckets...');
    const buckets = await s3.listBuckets().promise();
    console.log('Found buckets:', buckets.Buckets?.map(b => b.Name).join(', '));

    // Configure tool-data bucket
    const bucketName = 'tool-data';
    console.log(`\n⚙️ Configuring ${bucketName} bucket...`);

    // Set bucket policy for public read and authenticated write
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketName}/*`]
        },
        {
          Sid: 'AuthenticatedUpload',
          Effect: 'Allow',
          Principal: {
            AWS: '*'
          },
          Action: [
            's3:PutObject',
            's3:PutObjectAcl',
            's3:DeleteObject'
          ],
          Resource: [`arn:aws:s3:::${bucketName}/*`]
        }
      ]
    };

    try {
      await s3.putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify(bucketPolicy)
      }).promise();
      console.log('✅ Bucket policy updated successfully');
    } catch (error) {
      console.error('❌ Error updating bucket policy:', error.message);
      
      // Try alternative: Set bucket ACL
      try {
        await s3.putBucketAcl({
          Bucket: bucketName,
          ACL: 'public-read-write'
        }).promise();
        console.log('✅ Bucket ACL set to public-read-write');
      } catch (aclError) {
        console.error('❌ Error setting bucket ACL:', aclError.message);
      }
    }

    // Set CORS configuration
    const corsConfig = {
      CORSRules: [
        {
          AllowedHeaders: ['*'],
          AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          AllowedOrigins: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3000
        }
      ]
    };

    try {
      await s3.putBucketCors({
        Bucket: bucketName,
        CORSConfiguration: corsConfig
      }).promise();
      console.log('✅ CORS configuration updated');
    } catch (error) {
      console.error('❌ Error updating CORS:', error.message);
    }

    // Test upload capability
    console.log('\n🧪 Testing upload to tool-data bucket...');
    const testKey = `test/test-${Date.now()}.txt`;
    
    try {
      await s3.putObject({
        Bucket: bucketName,
        Key: testKey,
        Body: 'Test upload',
        ContentType: 'text/plain'
      }).promise();
      console.log('✅ Test upload successful');

      // Clean up test file
      await s3.deleteObject({
        Bucket: bucketName,
        Key: testKey
      }).promise();
      console.log('✅ Test file cleaned up');
    } catch (error) {
      console.error('❌ Test upload failed:', error.message);
    }

    console.log('\n✅ Bucket configuration complete!');
    
  } catch (error) {
    console.error('❌ Configuration failed:', error);
  }
}

// Run the configuration
configureBuckets();
