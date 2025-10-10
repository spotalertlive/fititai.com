// ==========================================
// SpotAlert AWS Link: S3 + Rekognition + SES
// ==========================================
import AWS from "aws-sdk";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

// ===== AWS Configuration =====
AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();
const ses = new AWS.SES({ apiVersion: "2010-12-01" });

// ===== Upload image to S3 =====
export async function uploadToS3(filePath, key) {
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: fileContent,
    ContentType: "image/jpeg",
  };
  await s3.putObject(params).promise();
  console.log(`📤 Uploaded to S3: ${key}`);
}

// ===== Detect faces with Rekognition =====
export async function detectFaces(bucket, key) {
  const params = { Image: { S3Object: { Bucket: bucket, Name: key } } };
  const response = await rekognition.detectFaces(params).promise();
  console.log(`🧠 Detected ${response.FaceDetails.length} face(s)`);
  return response.FaceDetails;
}

// ===== Send Alert Email =====
export async function sendAlertEmail(to, subject, message) {
  const params = {
    Source: process.env.ADMIN_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Text: { Data: message } },
    },
  };
  await ses.sendEmail(params).promise();
  console.log(`📧 Alert sent to ${to}`);
}
