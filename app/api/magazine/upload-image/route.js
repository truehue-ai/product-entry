export const runtime = 'nodejs';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const BUCKET      = process.env.X_AWS_BUCKET_NAME;
const CLOUDFRONT  = process.env.CLOUDFRONT_URL;

const s3 = new S3Client({
  region: process.env.X_AWS_REGION || 'ap-south-1',
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});

export async function POST(req) {
  try {
    const formData   = await req.formData();
    const file       = formData.get('file');
    const key        = formData.get('key');

    if (!file || !key) {
      return new Response(JSON.stringify({ error: 'Missing file or key' }), { status: 400 });
    }

    const buffer      = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || 'image/jpeg';

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }));

    const url = `${CLOUDFRONT}/${key}`;
    return new Response(JSON.stringify({ url, key }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}