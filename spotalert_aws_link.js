// ===============================
// SpotAlert AWS Core Connector
// Handles S3 Uploads, Face Detection, SES Alerts
// ===============================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import {
  RekognitionClient,
  ListCollectionsCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand
} from '@aws-sdk/client-rekognition';
import {
  SESClient,
  SendEmailCommand
} from '@aws-sdk/client-ses';

// === Environment ===
const {
  AWS_REGION,
  S3_BUCKET,
  REKOG_COLLECTION_ID,
  SES_FROM_EMAIL,
  SES_TO_EMAIL,
  ALERT_SUBJECT,
  MATCH_THRESHOLD = 92
} = process.env;

// === AWS Clients ===
const s3 = new S3Client({ region: AWS_REGION });
const rekog = new RekognitionClient({ region: AWS_REGION });
const ses = new SESClient({ region: AWS_REGION });

// ===================================
// 1️⃣  Upload image to S3
// ===================================
export async function uploadToS3(localPath, key) {
  const fileBuffer = fs.readFileSync(localPath);
  const putCmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: 'image/jpeg'
  });
  await s3.send(putCmd);
  console.log(`✔ Uploaded image to s3://${S3_BUCKET}/${key}`);
  return key;
}

// ===================================
// 2️⃣  Detect faces using Rekognition
// ===================================
export async function detectFaces(bucket, key) {
  try {
    // Ensure collection exists
    const collections = await rekog.send(new ListCollectionsCommand({}));
    if (!collections.CollectionIds.includes(REKOG_COLLECTION_ID)) {
      await rekog.send(new CreateCollectionCommand({ CollectionId: REKOG_COLLECTION_ID }));
      console.log(`🆕 Created Rekognition collection: ${REKOG_COLLECTION_ID}`);
    }

    // Search for faces
    const imgFile = fs.readFileSync(path.resolve('uploads', path.basename(key)));
    const searchCmd = new SearchFacesByImageCommand({
      CollectionId: REKOG_COLLECTION_ID,
      Image: { Bytes: imgFile },
      FaceMatchThreshold: Number(MATCH_THRESHOLD),
      MaxFaces: 3
    });
    const res = await rekog.send(searchCmd);
    const matches = res.FaceMatches || [];

    console.log(`👁️ Detected ${matches.length} face(s).`);
    return matches;
  } catch (err) {
    console.error('⚠️ Rekognition error:', err.message);
    return [];
  }
}

// ===================================
// 3️⃣  Send SES Email Alert
// ===================================
export async function sendAlertEmail(to, subject, message) {
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;color:#222">
        <h2>⚠️ SpotAlert — Unknown Person Detected</h2>
        <p>${new Date().toLocaleString()}</p>
        <p>${message}</p>
        <p style="color:#666;font-size:12px;margin-top:15px;">
          This automated alert was sent by SpotAlert.
        </p>
      </div>
    `;

    const sendCmd = new SendEmailCommand({
      Destination: { ToAddresses: [to || SES_TO_EMAIL] },
      Source: SES_FROM_EMAIL,
      Message: {
        Subject: { Data: subject || ALERT_SUBJECT || '[SpotAlert] Unknown Face Detected' },
        Body: { Html: { Data: html } }
      }
    });

    await ses.send(sendCmd);
    console.log(`📨 Alert email sent to ${to || SES_TO_EMAIL}`);
  } catch (err) {
    console.error('⚠️ SES email error:', err.message);
  }
}
