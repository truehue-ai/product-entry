import {
    S3Client,
    ListObjectsV2Command,
    PutObjectCommand
  } from "@aws-sdk/client-s3";
  
  const s3 = new S3Client({
    region: process.env.X_AWS_REGION,
    credentials: {
      accessKeyId: process.env.X_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.X_AWS_SECRET_ACCESS_KEY,
    },
  });
  
  const BUCKET = process.env.X_AWS_BUCKET_NAME;
  
  export async function POST() {
    try {
      const brandList = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "brands/",
        Delimiter: "/"
      }));
  
      const allData = {};
  
      const brands = brandList.CommonPrefixes.map(prefix =>
        prefix.Prefix.split("/")[1]
      );
  
      for (const brand of brands) {
        const productPrefix = `brands/${brand}/product_shade_values/`;
  
        const productList = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: productPrefix,
          Delimiter: "/"
        }));
  
        const products = productList.CommonPrefixes?.map(p => {
          const productName = p.Prefix.split("/")[3];
          return { [productName]: "Face" };
        }) || [];
  
        allData[brand] = products;
      }
  
      const jsonContent = JSON.stringify(allData, null, 2);
  
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: `all-data.json`,
        Body: jsonContent,
        ContentType: "application/json"
      }));
  
      return Response.json({ success: true });
    } catch (error) {
      console.error("Failed to generate all-data.json:", error);
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }
  }
  