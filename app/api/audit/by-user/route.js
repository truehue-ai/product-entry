export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
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
  const currentUser = cookies().get('th_auth')?.value || '';
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
