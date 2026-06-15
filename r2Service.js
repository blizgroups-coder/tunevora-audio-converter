const fs = require("fs");

const {
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "auto",

  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

  credentials: {
    accessKeyId:
      process.env.R2_ACCESS_KEY_ID,

    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(
  filePath,
  fileName
) {

  const fileBuffer =
    fs.readFileSync(filePath);

  const key =
    `songs/${fileName}`;

  await s3.send(
    new PutObjectCommand({

      Bucket:
        process.env.R2_BUCKET_NAME,

      Key:
        key,

      Body:
        fileBuffer,

      ContentType:
        "audio/mpeg",
    })
  );

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

module.exports = {
  uploadToR2,
};