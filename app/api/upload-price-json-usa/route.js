// app/api/upload-price-json/route.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

export async function POST(req) {
  const { brand, product, price } = await req.json();

  if (!brand || !product || !price) {
    return Response.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const jsonContent = JSON.stringify(price, null, 2);
  const bucket = process.env.X_AWS_BUCKET_NAME;

  const s3 = new S3Client({
    region: process.env.X_AWS_REGION,
    credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN })
  });

  const params = {
    Bucket: bucket,
    Key: `brands_usa/${brand}/price/${product}/price.json`,
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
