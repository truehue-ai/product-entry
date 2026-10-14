import {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
  } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { ensureVerifiedFile } from "../shade-capture/verifiedStore";
import { rejectUnlessActionPassword } from "../shade-capture/actionAuth";
  import { Readable } from "stream";
  
  const s3 = new S3Client({
    region: process.env.X_AWS_REGION,
    credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }),
  });
  
  const BUCKET = process.env.X_AWS_BUCKET_NAME;
  const FILE_KEY = "all-data-usa.json";
  
  const streamToString = (stream) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  
  export async function POST(req) {
    const { brand, product, type, password } = await req.json();
    const denied = rejectUnlessActionPassword(password);
    if (denied) return denied;
  
    if (!brand || !product || !type) {
      return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
    }
  
    // Snapshot "verified = live" before this product goes live, so it starts unverified.
    try { await ensureVerifiedFile("usa"); } catch (e) { console.error("verified snapshot failed:", e); }

    let currentData = {};
  
    try {
      const getRes = await s3.send(new GetObjectCommand({
        Bucket: BUCKET,
        Key: FILE_KEY,
      }));
  
      const jsonString = await streamToString(getRes.Body);
      currentData = JSON.parse(jsonString);
    } catch (err) {
      // File might not exist yet, which is okay
      console.warn("Starting with empty all-data.json:", err.message);
      currentData = {};
    }
  
    // Update logic
    if (!currentData[brand]) currentData[brand] = [];
  
    const productExists = currentData[brand].some(p => Object.keys(p)[0] === product);
    if (!productExists) {
      currentData[brand].push({ [product]: type });
    }
  
    // Upload back to S3
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: FILE_KEY,
        Body: JSON.stringify(currentData, null, 2),
        ContentType: "application/json"
      }));
      return Response.json({ success: true });
    } catch (err) {
      console.error("Failed to update all-data.json:", err);
      return Response.json({ success: false, error: err.message }, { status: 500 });
    }
  }
  