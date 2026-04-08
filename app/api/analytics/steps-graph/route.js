export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.X_AWS_REGION,
  credentials: {
    accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.X_AWS_BUCKET_NAME || "truehue-backend-data";
const GRAPH_KEY = "permanent/analytics/daily_graph.json";

export async function GET() {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: GRAPH_KEY }));
    const text = await r.Body.transformToString();
    const graph = JSON.parse(text);

    return new Response(JSON.stringify({ graph }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}