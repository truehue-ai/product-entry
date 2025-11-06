// app/api/upload-shades/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.X_AWS_BUCKET_NAME;

// util: extract shade names from incoming array
const getNamesFromIncoming = (arr) =>
  Array.isArray(arr) ? arr.map(s => s?.name).filter(Boolean) : [];

export async function POST(req) {
  try {
    const { brand, product, shades, category } = await req.json();
    if (!brand || !product || !Array.isArray(shades) || !category) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    }

    // 1) Build the shades.json payload (same structure you had)
    let shadeDict = {};
    if (['foundation', 'contour', 'concealer', 'skin-tint'].includes(category)) {
      // nested: { skintone: { undertone: { shade_name: hex } } }
      for (const { name, hex, skintone, undertone } of shades) {
        if (!name || !hex || !skintone || !undertone) continue;
        if (!shadeDict[skintone]) shadeDict[skintone] = {};
        if (!shadeDict[skintone][undertone]) shadeDict[skintone][undertone] = {};
        shadeDict[skintone][undertone][name] = hex;
      }
    } else {
      // flat: { "shadeName": "#HEX" }
      for (const { name, hex } of shades) {
        if (name && hex) shadeDict[name] = hex;
      }
    }

    const base = `brands/${brand}/product_shade_values/${product}`;
    const shadesKey = `${base}/shades.json`;

    // 2) Write shades.json
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: shadesKey,
        Body: JSON.stringify(shadeDict, null, 2),
        ContentType: 'application/json',
      })
    );

    // 3) Write meta.json (who/when/type) for “Saved by” in Logs
    const user = cookies().get('th_auth')?.value || 'unknown';
    const nowISO = new Date().toISOString();
    const meta = {
      brand,
      product,
      productType: category,
      lastSavedBy: user,
      lastSavedAt: nowISO,
    };
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `${base}/meta.json`,
        Body: JSON.stringify(meta, null, 2),
        ContentType: 'application/json',
      })
    );

    // 4) DAILY AUDIT: log ALL shades from this save (no diffing)
    // file: audit/daily/YYYY-MM-DD/<user>.json  (array of entries)
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const day = `${yyyy}-${mm}-${dd}`;
    const auditKey = `audit/daily/${day}/${user}.json`;

    const savedNames = getNamesFromIncoming(shades);

    // append-only write (we don’t fetch/merge; simple overwrite pattern)
    // safest is to read-modify-write, but since we removed comparisons,
    // we can just fetch once; if fetch fails, start with [].
    let existing = [];
    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: auditKey }));
      const text = await r.Body.transformToString();
      existing = JSON.parse(text) || [];
    } catch {
      existing = [];
    }
    existing.push({
      brand,
      product,
      productType: category,
      added: savedNames,   // ← now represents ALL shades saved in this request
      at: nowISO,
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: auditKey,
        Body: JSON.stringify(existing, null, 2),
        ContentType: 'application/json',
      })
    );

    return NextResponse.json({ success: true, added: savedNames });
  } catch (error) {
    console.error('S3 upload failed:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Upload failed' }, { status: 500 });
  }
}
