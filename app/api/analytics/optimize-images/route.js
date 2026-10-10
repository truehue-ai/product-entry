export const runtime = "nodejs";

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import sharp from "sharp";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  requestHandler: new NodeHttpHandler({
    maxSockets: 50,
    socketAcquisitionWarningTimeout: 15000,
  }),
});

const BUCKET = process.env.X_AWS_BUCKET_NAME;

// All image folders under assets/
const IMAGE_FOLDERS = [
  "assets/drinks/",
  "assets/snacks/",
  "assets/sip-snack/",
  "assets/memoji/",
  "assets/preview/",
  "assets/compare/",
  "assets/helps/",
  "assets/images/",
];

const OUTPUT_PREFIX = "assets_smaller/";

const MAX_WIDTH = 800;
const WEBP_QUALITY = 92;

async function listKeysInFolder(prefix) {
  let ContinuationToken;
  const keys = [];
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken })
    );
    for (const obj of resp.Contents || []) {
      if (obj.Key && /\.(png|jpg|jpeg|webp)$/i.test(obj.Key)) {
        keys.push({ key: obj.Key, size: obj.Size });
      }
    }
    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

async function getS3Object(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function optimizeImage(buffer) {
  const image = sharp(buffer);
  const meta = await image.metadata();

  // Only resize if wider than MAX_WIDTH
  const pipeline = meta.width > MAX_WIDTH
    ? image.resize(MAX_WIDTH, null, { withoutEnlargement: true })
    : image;

  const optimized = await pipeline
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer();

  return { optimized, originalSize: buffer.length, optimizedSize: optimized.length };
}

// POST /api/analytics/optimize-images
// Body: { folders?: string[], dryRun?: boolean }
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const foldersToProcess = body.folders?.length
      ? body.folders.map((f) => (f.endsWith("/") ? f : f + "/"))
      : IMAGE_FOLDERS;
    const dryRun = body.dryRun === true;

    const results = [];
    let totalOriginalBytes = 0;
    let totalOptimizedBytes = 0;
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    // Process folders sequentially to avoid memory spikes
    for (const folder of foldersToProcess) {
      const keys = await listKeysInFolder(folder);

      // Process each folder's files in batches of 5
      const BATCH = 5;
      for (let i = 0; i < keys.length; i += BATCH) {
        const batch = keys.slice(i, i + BATCH);

        await Promise.all(batch.map(async ({ key, size }) => {
          try {
            const buffer = await getS3Object(key);

            // Skip tiny files (already optimized or icons)
            if (buffer.length < 5 * 1024) {
              totalSkipped++;
              results.push({ key, status: "skipped", reason: "< 5KB" });
              return;
            }

            const { optimized, originalSize, optimizedSize } = await optimizeImage(buffer);

            totalOriginalBytes += originalSize;
            totalOptimizedBytes += optimizedSize;

            const savingPct = Math.round((1 - optimizedSize / originalSize) * 100);

            if (!dryRun) {
              const outputKey = key.replace(/^assets\//, OUTPUT_PREFIX);
              await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: outputKey,
                Body: optimized,
                ContentType: "image/webp",
                CacheControl: "public, max-age=31536000, immutable",
              }));
            }

            const outputKey = key.replace(/^assets\//, OUTPUT_PREFIX);
            totalProcessed++;
            results.push({
              key,
              outputKey: dryRun ? key.replace(/^assets\//, OUTPUT_PREFIX) : outputKey,
              status: dryRun ? "dry-run" : "optimized",
              originalKB: Math.round(originalSize / 1024),
              optimizedKB: Math.round(optimizedSize / 1024),
              savingPct,
            });
          } catch (e) {
            totalFailed++;
            results.push({ key, status: "failed", error: e.message });
          }
        }));
      }
    }

    const totalSavingPct = totalOriginalBytes > 0
      ? Math.round((1 - totalOptimizedBytes / totalOriginalBytes) * 100)
      : 0;

    return new Response(
      JSON.stringify({
        ok: true,
        dryRun,
        summary: {
          processed: totalProcessed,
          skipped: totalSkipped,
          failed: totalFailed,
          originalMB: (totalOriginalBytes / 1024 / 1024).toFixed(1),
          optimizedMB: (totalOptimizedBytes / 1024 / 1024).toFixed(1),
          savingPct: totalSavingPct,
        },
        results,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "Optimization failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// GET: just list what would be processed (count only, no download)
export async function GET() {
  try {
    const folderSummaries = await Promise.all(
      IMAGE_FOLDERS.map(async (folder) => {
        const keys = await listKeysInFolder(folder);
        const totalBytes = keys.reduce((s, k) => s + (k.size || 0), 0);
        return {
          folder,
          fileCount: keys.length,
          totalMB: (totalBytes / 1024 / 1024).toFixed(1),
        };
      })
    );

    return new Response(
      JSON.stringify({ ok: true, folders: folderSummaries }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}