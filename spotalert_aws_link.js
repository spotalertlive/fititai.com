// =============================================
// SpotAlert AWS Connector – S3 + Rekognition + SES
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

// === AWS Config ===
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET = process.env.S3_BUCKET || "your-s3-bucket-name";
const REKOG_COLLECTION_ID = process.env.REKOG_COLLECTION_ID || "SpotAlertFaces";
const SES_FROM_EMAIL = "aispotalert@gmail.com"; // Verified sender
const SES_TO_EMAIL = process.env.SES_TO_EMAIL || "aispotalert@gmail.com";
const ALERT_SUBJECT = process.env.ALERT_SUBJECT || "SpotAlert: Unknown Person Detected";

// === AWS Clients ===
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: "AKIA2BXFZWTHAWSPRZPL",
    secretAccessKey: "maPeZ1TKm9RmUK0P/9qkJ/1M6koCniTK6JnsFMz",
  },
});

const rekog = new RekognitionClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: "AKIA2BXFZWTHAWSPRZPL",
    secretAccessKey: "maPeZ1TKm9RmUK0P/9qkJ/1M6koCniTK6JnsFMz",
  },
});

const ses = new SESClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: "AKIA2BXFZWTHAWSPRZPL",
    secretAccessKey: "maPeZ1TKm9RmUK0P/9qkJ/1M6koCniTK6JnsFMz",
  },
});

// === Upload Image ===
export async function uploadToS3(localPath, key) {
  const buffer = fs.readFileSync(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    })
  );
  console.log(`✅ Uploaded to S3: ${S3_BUCKET}/${key}`);
  return key;
}

// === Detect Faces ===
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
    return res.FaceMatches || [];
  } catch (err) {
    console.error("⚠️ Rekognition Error:", err.message);
    return [];
  }
}

// === Send Email (SES) ===
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
              Data: `
                <h3>${subject || ALERT_SUBJECT}</h3>
                <p>${msg}</p>
                <p><small>Sent by SpotAlert AI System</small></p>
              `,
            },
          },
        },
      })
    );
    console.log(`📨 Email alert sent to ${to}`);
  } catch (err) {
    console.error("⚠️ SES Error:", err.message);
  }
}
