// =============================================
// SpotAlert AWS Connector – S3 + Rekognition + SES + Health Check
// =============================================

import "dotenv/config";
import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  RekognitionClient,
  ListCollectionsCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import fetch from "node-fetch"; // ensure node-fetch installed (npm i node-fetch)

// === AWS Config ===
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "spotalert";
const REKOG_COLLECTION_ID = process.env.REKOG_COLLECTION_ID || "SpotAlertCollection";
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || "aispotalert@gmail.com";
const SES_TO_EMAIL = process.env.SES_TO_EMAIL || "aispotalert@gmail.com";
const ALERT_SUBJECT = process.env.ALERT_SUBJECT || "[SpotAlert] Unknown Face Detected";

// === AWS Clients ===
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

const s3 = new S3Client({ region: AWS_REGION, credentials });
const rekog = new RekognitionClient({ region: AWS_REGION, credentials });
const ses = new SESClient({ region: AWS_REGION, credentials });

// === Upload Image to S3 ===
export async function uploadToS3(localPath, key) {
  try {
    const buffer = fs.readFileSync(localPath);
    await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: "image/jpeg" }));
    console.log(`✅ Uploaded to S3: ${S3_BUCKET}/${key}`);
    return key;
  } catch (err) {
    console.error("⚠️ S3 Upload Error:", err.message);
    throw err;
  }
}

// === Detect Faces using Rekognition ===
export async function detectFaces(bucket, key) {
  try {
    const collections = await rekog.send(new ListCollectionsCommand({}));
    if (!collections.CollectionIds.includes(REKOG_COLLECTION_ID)) {
      await rekog.send(new CreateCollectionCommand({ CollectionId: REKOG_COLLECTION_ID }));
      console.log(`🆕 Created collection: ${REKOG_COLLECTION_ID}`);
    }
    const img = fs.readFileSync(path.resolve("uploads", path.basename(key)));
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
  } catch (err) {
    console.error("⚠️ Rekognition Error:", err.message);
    return [];
  }
}

// === Send Email via SES ===
export async function sendAlertEmail(to, subject, msg) {
  try {
    await ses.send(
      new SendEmailCommand({
        Destination: { ToAddresses: [to || SES_TO_EMAIL] },
        Source: SES_FROM_EMAIL,
        Message: {
          Subject: { Data: subject || ALERT_SUBJECT },
          Body: {
            Html: {
              Data: `<h3>${subject || ALERT_SUBJECT}</h3>
                     <p>${msg}</p>
                     <p><small>Sent automatically by SpotAlert AI System</small></p>`,
            },
          },
        },
      })
    );
    console.log(`📨 Email alert sent to ${to}`);
  } catch (err) {
    console.error("⚠️ SES Email Error:", err.message);
  }
}

// =============================================
// 🧠 SpotAlert Health Check System
// =============================================
export async function runSpotAlertHealthCheck() {
  const logFile = "aws_test_report.txt";
  const log = [];
  const now = new Date().toLocaleString();
  log.push(`🧾 SpotAlert AWS Health Check Report – ${now}`);
  log.push("--------------------------------------------------");

  // 1️⃣ Check Backend
  try {
    const res = await fetch(process.env.BASE_URL);
    log.push(`✅ Backend reachable (${res.status}) → ${process.env.BASE_URL}`);
  } catch (err) {
    log.push(`❌ Backend unreachable → ${err.message}`);
  }

  // 2️⃣ Test S3 Upload
  try {
    const testFile = "public/spotalert_logo.png";
    if (fs.existsSync(testFile)) {
      await uploadToS3(testFile, "healthcheck_test_image.png");
      log.push("✅ S3 upload successful");
    } else {
      log.push("⚠️ No logo found, skipped S3 upload test");
    }
  } catch (err) {
    log.push(`❌ S3 upload failed → ${err.message}`);
  }

  // 3️⃣ Test Rekognition
  try {
    await detectFaces(S3_BUCKET, "healthcheck_test_image.png");
    log.push("✅ Rekognition connected successfully");
  } catch (err) {
    log.push(`❌ Rekognition test failed → ${err.message}`);
  }

  // 4️⃣ Test SES Email
  try {
    await sendAlertEmail(SES_TO_EMAIL, "SpotAlert Health Check", "✅ SES test email sent successfully.");
    log.push("✅ SES email sent successfully");
  } catch (err) {
    log.push(`❌ SES email failed → ${err.message}`);
  }

  // 🧾 Write Report
  fs.appendFileSync(logFile, log.join("\n") + "\n\n");
  console.log(`\n✅ Health check complete → Results saved in ${logFile}`);
  console.log(log.join("\n"));
}

// Auto-run when executed directly
if (process.argv[1].includes("spotalert_aws_link.js")) {
  runSpotAlertHealthCheck();
}
