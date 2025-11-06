// app/api/upload-type-json/route.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export async function POST(req) {
  const { brand, product, type } = await req.json();

  if (!brand || !product || !type) {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const jsonContent = JSON.stringify(type, null, 2);
  const bucket = process.env.X_AWS_BUCKET_NAME;

  const s3 = new S3Client({
    region: process.env.X_AWS_REGION,
    credentials: {
      accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
    }
  });

  const params = {
    Bucket: bucket,
    Key: `brands/${brand}/type/${product}/type.json`,
    Body: jsonContent,
    ContentType: "application/json"
  };

  try {
    await s3.send(new PutObjectCommand(params));
    return Response.json({ success: true });
  } catch (error) {
    console.error("S3 upload failed:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
