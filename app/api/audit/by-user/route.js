export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../lib/auth';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

async function getJSON(Key) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    const text = await r.Body.transformToString();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(req) {
  // Only dhruvi can query audit
  const currentUser = (await getSessionUser()) || '';
  if (currentUser !== 'dhruvi') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const user = searchParams.get('user');              // e.g. "aastha" or "dhruvi"
  const day  = searchParams.get('date');              // "YYYY-MM-DD"

  if (!user || !day) {
    return NextResponse.json({ error: 'Missing user or date' }, { status: 400 });
  }

  const key = `audit/daily/${day}/${user}.json`;
  const entries = (await getJSON(key)) || [];
  // shape: [{ brand, product, productType, added: [...], at }]

  return NextResponse.json({ user, date: day, entries });
}
