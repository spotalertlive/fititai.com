// ===============================
// SpotAlert AWS Backend Server (Final Build)
// ===============================
import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import {
  RekognitionClient,
  ListCollectionsCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand
} from "@aws-sdk/client-rekognition";
import {
  SESClient,
  SendEmailCommand
} from "@aws-sdk/client-ses";

const app = express();

// ===== Embedded ENV Variables =====
const CONFIG = {
  PORT: 3000,
  AWS_REGION: "us-east-1",
  S3_BUCKET: "spotalert",
  REKOG_COLLECTION_ID: "SpotAlertCollection",
  SES_FROM_EMAIL: "alerts@spotalert.live",
  SES_TO_EMAIL: "admin@spotalert.live",
  ALERT_SUBJECT: "[SpotAlert] Unknown Face Detected"
};

// ===== AWS Clients =====
const s3 = new S3Client({ region: CONFIG.AWS_REGION });
const rekog = new RekognitionClient({ region: CONFIG.AWS_REGION });
const ses = new SESClient({ region: CONFIG.AWS_REGION });

// ===== Middleware =====
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static("public"));

// ===== SQLite =====
const db = new sqlite3.Database("spotalert.db");
db.run(`CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  timestamp TEXT,
  image TEXT
)`);

// ===== Paths =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ===== Helper: Upload to S3 =====
async function uploadToS3(localPath, key) {
  const buffer = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg"
  }));
  console.log(`✅ Uploaded to S3: ${CONFIG.S3_BUCKET}/${key}`);
  return key;
}

// ===== Helper: Detect Faces =====
async function detectFaces(bucket, key) {
  try {
    const collections = await rekog.send(new ListCollectionsCommand({}));
    if (!collections.CollectionIds.includes(CONFIG.REKOG_COLLECTION_ID)) {
      await rekog.send(new CreateCollectionCommand({ CollectionId: CONFIG.REKOG_COLLECTION_ID }));
      console.log(`🆕 Created collection: ${CONFIG.REKOG_COLLECTION_ID}`);
    }

    const img = fs.readFileSync(path.resolve("uploads", path.basename(key)));
    const res = await rekog.send(new SearchFacesByImageCommand({
      CollectionId: CONFIG.REKOG_COLLECTION_ID,
      Image: { Bytes: img },
      FaceMatchThreshold: 90,
      MaxFaces: 5
    }));
    return res.FaceMatches || [];
  } catch (err) {
    console.error("⚠️ Rekognition Error:", err.message);
    return [];
  }
}

// ===== Helper: Send Email =====
async function sendAlertEmail(to, subject, msg) {
  try {
    await ses.send(new SendEmailCommand({
      Destination: { ToAddresses: [to || CONFIG.SES_TO_EMAIL] },
      Source: CONFIG.SES_FROM_EMAIL,
      Message: {
        Subject: { Data: subject || CONFIG.ALERT_SUBJECT },
        Body: {
          Html: { Data: `<p>${msg}</p><p><small>Sent by SpotAlert</small></p>` }
        }
      }
    }));
    console.log(`📨 Email sent to ${to}`);
  } catch (err) {
    console.error("⚠️ SES Error:", err.message);
  }
}

// ===== ROUTES =====
app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public" }));

app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ===== Image Detection + Alert =====
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;

    await uploadToS3(imagePath, key);
    const faces = await detectFaces(CONFIG.S3_BUCKET, key);

    db.run("INSERT INTO alerts (type, timestamp, image) VALUES (?, ?, ?)",
      [faces.length > 0 ? "known_face" : "unknown_face", new Date().toISOString(), key]);

    if (faces.length === 0) {
      await sendAlertEmail(
        CONFIG.SES_TO_EMAIL,
        CONFIG.ALERT_SUBJECT,
        `🚨 Unknown face detected at ${new Date().toLocaleString()}<br><br>Image: ${key}`
      );
    }

    res.json({ ok: true, faces, key });
  } catch (err) {
    console.error("⚠️ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Shira Assistant =====
app.post("/shira", (req, res) => {
  const msg = (req.body.message || "").toLowerCase();
  let reply = "👋 Hi, I’m Shira — your SpotAlert assistant. How can I help you?";

  if (msg.includes("plan")) reply = "💡 SpotAlert offers multiple plans — Basic, Standard, Premium, and Elite.";
  else if (msg.includes("trial")) reply = "🎁 You get a 14-day free trial before your first billing.";
  else if (msg.includes("camera")) reply = "📷 You can link multiple cameras — depending on your subscription.";
  else if (msg.includes("alert")) reply = "🚨 SpotAlert sends instant alerts via email or SMS when an unknown face is seen.";
  else if (msg.includes("privacy")) reply = "🔒 All data is encrypted and stored securely in your own region.";
  else if (msg.includes("contact")) reply = "📧 Reach us at admin@spotalert.live anytime.";

  res.json({ reply });
});

// ===== Start Server =====
app.listen(CONFIG.PORT, () =>
  console.log(`✅ SpotAlert live on port ${CONFIG.PORT}`)
);
