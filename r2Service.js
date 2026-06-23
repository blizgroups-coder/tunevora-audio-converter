const fs = require("fs");

const {
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",

  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

  forcePathStyle: true,

  credentials: {
    accessKeyId:
      process.env.R2_ACCESS_KEY_ID,

    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(
  filePath,
  fileName,
  folder = "songs",
  contentType = "audio/mpeg"
) {

  const fileBuffer =
    fs.readFileSync(filePath);

  const key =
    `${folder}/${fileName}`;

  console.log(
    "Uploading to bucket:",
    process.env.R2_BUCKET_NAME
  );

  console.log(
    "Key:",
    key
  );

  await s3.send(
    new PutObjectCommand({
      Bucket:
        process.env.R2_BUCKET_NAME,

      Key:
        key,

      Body:
        fileBuffer,

      ContentType:
        contentType,
    })
  );

  console.log(
    "R2 Upload Success:",
    key
  );

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = {
  uploadToR2,
};