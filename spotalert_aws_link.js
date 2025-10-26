// =============================================
// SpotAlert AWS Connector – S3 + Rekognition + SES + Health Check (SERVER READY)
// =============================================
import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  RekognitionClient,
  ListCollectionsCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import fetch from "node-fetch";

// === Setup ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "spotalert";
const REKOG_COLLECTION_ID = process.env.REKOG_COLLECTION_ID || "SpotAlertCollection";
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || "aispotalert@gmail.com";
const SES_TO_EMAIL = process.env.SES_TO_EMAIL || "aispotalert@gmail.com";
const ALERT_SUBJECT = process.env.ALERT_SUBJECT || "[SpotAlert] Unknown Face Detected";

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

const s3 = new S3Client({ region: AWS_REGION, credentials });
const rekog = new RekognitionClient({ region: AWS_REGION, credentials });
const ses = new SESClient({ region: AWS_REGION, credentials });

// === AWS Helpers ===
async function uploadToS3(localPath, key) {
  const buffer = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: "image/jpeg" }));
  console.log(`✅ Uploaded to S3: ${S3_BUCKET}/${key}`);
}

async function detectFaces(bucket, key) {
  const collections = await rekog.send(new ListCollectionsCommand({}));
  if (!collections.CollectionIds.includes(REKOG_COLLECTION_ID)) {
    await rekog.send(new CreateCollectionCommand({ CollectionId: REKOG_COLLECTION_ID }));
  }
  const img = fs.readFileSync(path.resolve(__dirname, "uploads", path.basename(key)));
  const res = await rekog.send(
    new SearchFacesByImageCommand({
      CollectionId: REKOG_COLLECTION_ID,
      Image: { Bytes: img },
      FaceMatchThreshold: 90,
      MaxFaces: 5,
    })
  );
  console.log(`🔍 Face Matches: ${res.FaceMatches?.length || 0}`);
  return res.FaceMatches || [];
}

async function sendAlertEmail(to, subject, msg) {
  await ses.send(
    new SendEmailCommand({
      Destination: { ToAddresses: [to || SES_TO_EMAIL] },
      Source: SES_FROM_EMAIL,
      Message: {
        Subject: { Data: subject || ALERT_SUBJECT },
        Body: { Html: { Data: `<p>${msg}</p>` } },
      },
    })
  );
  console.log(`📨 Email sent to ${to}`);
}

// === Express Routes ===
app.get("/", (req, res) => {
  res.json({ message: "✅ SpotAlert backend running", time: new Date().toISOString() });
});

app.get("/healthcheck", async (req, res) => {
  const report = [];
  try {
    await fetch(process.env.BASE_URL);
    report.push("Backend reachable");
  } catch {
    report.push("Backend unreachable");
  }
  try {
    await sendAlertEmail(SES_TO_EMAIL, "SpotAlert HealthCheck", "System OK");
    report.push("SES email OK");
  } catch {
    report.push("SES email failed");
  }
  res.json({ report });
});

// === Start Server ===
app.listen(PORT, () => {
  console.log(`🚀 SpotAlert backend running on port ${PORT}`);
});
