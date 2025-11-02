// =============================================
// SpotAlert AWS Connector – S3 + Rekognition + SES + Health Check
// =============================================
import "dotenv/config";
import express from "express";
import cors from "cors"; // ✅ allows frontend connection
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  RekognitionClient,
  ListCollectionsCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// NOTE: Node 18+ has global fetch. No node-fetch import needed.

const app = express();
app.use(express.json());
app.use(cors({ origin: "https://spotalert.live" })); // ✅ enable HTTPS frontend communication

// --- ENV ---
const PORT = process.env.PORT || 3000;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "spotalert";
const REKOG_COLLECTION_ID = process.env.REKOG_COLLECTION_ID || "SpotAlertCollection";
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || "aispotalert@gmail.com";
const SES_TO_EMAIL = process.env.SES_TO_EMAIL || "aispotalert@gmail.com";
const ALERT_SUBJECT = process.env.ALERT_SUBJECT || "[SpotAlert] Unknown Face Detected";
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

const s3 = new S3Client({ region: AWS_REGION, credentials });
const rekog = new RekognitionClient({ region: AWS_REGION, credentials });
const ses = new SESClient({ region: AWS_REGION, credentials });

// --- Helpers ---
async function ensureCollection() {
  const listed = await rekog.send(new ListCollectionsCommand({}));
  const ids = listed?.CollectionIds || [];
  if (!ids.includes(REKOG_COLLECTION_ID)) {
    await rekog.send(new CreateCollectionCommand({ CollectionId: REKOG_COLLECTION_ID }));
    console.log(`✔ Created Rekognition collection: ${REKOG_COLLECTION_ID}`);
  } else {
    console.log(`✔ Using Rekognition collection: ${REKOG_COLLECTION_ID}`);
  }
}

export async function uploadToS3(buffer, key, contentType = "image/jpeg") {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  console.log(`✅ Uploaded to s3://${S3_BUCKET}/${key}`);
  return { bucket: S3_BUCKET, key };
}

export async function detectFaces(bucket, key) {
  await ensureCollection();
  const res = await rekog.send(new SearchFacesByImageCommand({
    CollectionId: REKOG_COLLECTION_ID,
    Image: { S3Object: { Bucket: bucket, Name: key } },
    FaceMatchThreshold: 90,
    MaxFaces: 5,
  }));
  const matches = res?.FaceMatches || [];
  console.log(`🔍 Face Matches: ${matches.length}`);
  return matches;
}

export async function sendAlertEmail(to, subject, htmlMsg) {
  await ses.send(new SendEmailCommand({
    Destination: { ToAddresses: [to || SES_TO_EMAIL] },
    Source: SES_FROM_EMAIL,
    Message: {
      Subject: { Data: subject || ALERT_SUBJECT },
      Body: { Html: { Data: htmlMsg } },
    },
  }));
  console.log(`📨 Email sent to ${to || SES_TO_EMAIL}`);
}

// --- Routes ---
app.get("/", (req, res) => {
  res.json({ ok: true, message: "✅ SpotAlert backend running", time: new Date().toISOString() });
});

app.get("/healthcheck", async (req, res) => {
  const report = [];
  try {
    const r = await fetch(BASE_URL, { method: "GET" });
    report.push(`Backend reachable: ${r.ok}`);
  } catch (e) {
    report.push("Backend unreachable");
  }
  try {
    await sendAlertEmail(SES_TO_EMAIL, "SpotAlert HealthCheck", "<p>System OK</p>");
    report.push("SES email OK");
  } catch {
    report.push("SES email failed");
  }
  res.json({ report, at: new Date().toISOString() });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`🚀 SpotAlert backend running on port ${PORT}`);
});
