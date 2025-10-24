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
const S3_BUCKET = process.env.S3_BUCKET || "spotalert";
const REKOG_COLLECTION_ID = process.env.REKOG_COLLECTION_ID || "SpotAlertCollection";
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || "aispotalert@gmail.com";
const SES_TO_EMAIL = process.env.SES_TO_EMAIL || "aispotalert@gmail.com";
const ALERT_SUBJECT = process.env.ALERT_SUBJECT || "[SpotAlert] Unknown Face Detected";

// === AWS Clients ===
const s3 = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const rekog = new RekognitionClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ses = new SESClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// === Upload Image to S3 ===
export async function uploadToS3(localPath, key) {
  try {
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
              Data: `
                <h3>${subject || ALERT_SUBJECT}</h3>
                <p>${msg}</p>
                <p><small>Sent automatically by SpotAlert AI System</small></p>
              `,
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
