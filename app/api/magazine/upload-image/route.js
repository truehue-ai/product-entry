export const runtime = 'nodejs';

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { denyUnlessDhruvi, json } from '../backend';

// Article images (featured image / cover overlay) — dhruvi only, and ONLY to
// magazine/<article-id>/image[_v<n>].<ext> or magazine/<article-id>/overlay.<ext>, images up to 8 MB.
// Nothing else in the bucket can be written through here.

const BUCKET      = process.env.X_AWS_BUCKET_NAME;
const CLOUDFRONT  = process.env.CLOUDFRONT_URL;
const ALLOWED_KEY = /^magazine\/[a-z0-9][a-z0-9-]{0,119}\/(image(_v\d{1,16})?|overlay)\.(jpg|jpeg|png|webp)$/;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 8 * 1024 * 1024;

const s3 = new S3Client({
  region: process.env.X_AWS_REGION || 'ap-south-1',
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});

export async function POST(req) {
  const denied = await denyUnlessDhruvi();
  if (denied) return denied;
  try {
    const formData = await req.formData();
    const file     = formData.get('file');
    const key      = String(formData.get('key') || '');

    if (!file || typeof file === 'string') return json({ error: 'Missing file' }, 400);
    if (!ALLOWED_KEY.test(key)) return json({ error: 'Images can only be saved as magazine/<article-id>/image or overlay (.jpg, .png, .webp)' }, 400);
    if (!ALLOWED_TYPES.has(file.type)) return json({ error: 'Only JPG, PNG or WebP images' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'Image is over 8 MB' }, 400);

    await s3.send(new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
    }));
    return json({ url: `${CLOUDFRONT}/${key}`, key });
  } catch (e) {
    return json({ error: e?.message || 'Upload failed' }, 500);
  }
}
