// ===========================================================
//  SpotAlert AWS Backend — FINAL CONSOLIDATED (v3.1)
//  Matches dashboard calls (replay/frame-url/incident-pdf)
// ===========================================================

import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  RekognitionClient,
  ListCollectionsCommand,
  CreateCollectionCommand,
  SearchFacesByImageCommand
} from "@aws-sdk/client-rekognition";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// ===========================================================
// CONFIG (ENV first, then defaults you provided)
// ===========================================================
const CONFIG = {
  PORT: Number(process.env.PORT || 3000),
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET || "spotalert",
  REKOG_COLLECTION_ID: process.env.REKOG_COLLECTION_ID || "SpotAlertCollection",
  SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || "alerts@spotalert.live",
  SES_TO_EMAIL: process.env.SES_TO_EMAIL || "admin@spotalert.live",
  ALERT_SUBJECT: process.env.ALERT_SUBJECT || "[SpotAlert] Unknown Face Detected",
};

// ===========================================================
// COST & PLAN LIMITS
// ===========================================================
const PRICING = {
  app: 0.001,       // in USD
  email: 0.002,
  whatsapp: 0.006,
  sms: 0.005,
};

// Monthly top-up threshold (illustrative)
const PLAN_LIMITS = {
  Free: 0,
  Standard: 5,
  Premium: 10,
  Elite: 25,
};

// ===========================================================
// AWS CLIENTS
// ===========================================================
const s3 = new S3Client({ region: CONFIG.AWS_REGION });
const rekog = new RekognitionClient({ region: CONFIG.AWS_REGION });
const ses = new SESClient({ region: CONFIG.AWS_REGION });

// ===========================================================
// EXPRESS
// ===========================================================
const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static("public"));

// ===========================================================
// DATABASE
// ===========================================================
const db = new sqlite3.Database("spotalert.db");

db.run(`CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  timestamp TEXT,
  image TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT,
  plan TEXT,
  channel TEXT,
  cost_usd REAL,
  timestamp TEXT
)`);

// ===========================================================
// FILE UPLOADS
// ===========================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ===========================================================
// HELPERS
// ===========================================================

// Upload to S3 (after Rekognition)
async function uploadToS3(localPath, key) {
  const buffer = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: CONFIG.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "image/jpeg",
  }));
  return key;
}

// Detect faces using the uploaded local file
async function detectFaces(localPath) {
  try {
    const collections = await rekog.send(new ListCollectionsCommand({}));
    if (!collections.CollectionIds.includes(CONFIG.REKOG_COLLECTION_ID)) {
      await rekog.send(new CreateCollectionCommand({ CollectionId: CONFIG.REKOG_COLLECTION_ID }));
      console.log(`🆕 Created Rekognition collection: ${CONFIG.REKOG_COLLECTION_ID}`);
    }

    const img = fs.readFileSync(localPath);
    const res = await rekog.send(new SearchFacesByImageCommand({
      CollectionId: CONFIG.REKOG_COLLECTION_ID,
      Image: { Bytes: img },
      FaceMatchThreshold: 90,
      MaxFaces: 5,
    }));
    return res.FaceMatches || [];
  } catch (err) {
    console.error("⚠️ Rekognition Error:", err.message);
    return [];
  }
}

// Send SES email
async function sendAlertEmail(to, subject, html) {
  try {
    await ses.send(new SendEmailCommand({
      Destination: { ToAddresses: [to || CONFIG.SES_TO_EMAIL] },
      Source: CONFIG.SES_FROM_EMAIL,
      Message: {
        Subject: { Data: subject || CONFIG.ALERT_SUBJECT },
        Body: { Html: { Data: html } }
      }
    }));
  } catch (err) {
    console.error("⚠️ SES Error:", err.message);
  }
}

// Log per-channel usage
function logUsage(user, plan, channel, cost) {
  db.run(
    "INSERT INTO usage_log (user_email, plan, channel, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?)",
    [user, plan, channel, cost, new Date().toISOString()]
  );
}

// Check top-up threshold for the month
function checkAndTopUp(user, plan) {
  const since = new Date(); since.setDate(1);
  const sinceISO = since.toISOString();

  db.get(
    "SELECT SUM(cost_usd) as total FROM usage_log WHERE user_email = ? AND timestamp >= ?",
    [user, sinceISO],
    (err, row) => {
      if (row && row.total && row.total > (PLAN_LIMITS[plan] || 0)) {
        sendAlertEmail(
          user,
          "[SpotAlert] Top-Up Needed",
          `Hi, your monthly alert usage exceeded your ${plan} plan limit. Please top up your account to continue receiving all alerts.`
        );
      }
    }
  );
}

// ===========================================================
// ROUTES
// ===========================================================

app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public" }));

app.get("/health", (_, res) =>
  res.json({ status: "ok", time: new Date().toISOString() })
);

// ===== Trigger Alert (Upload + Detect + Store + Notify) =====
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try:
    const localPath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;
    const plan = (req.body.plan || "Free");
    const userEmail = (req.body.email || CONFIG.SES_TO_EMAIL);

    // Detect first (from local), then upload
    const faces = await detectFaces(localPath);
    await uploadToS3(localPath, key);

    const type = faces.length > 0 ? "known_face" : "unknown_face";
    db.run("INSERT INTO alerts (type, timestamp, image) VALUES (?, ?, ?)",
      [type, new Date().toISOString(), key]
    );

    // Usage logging: email + app (match current behavior)
    logUsage(userEmail, plan, "email", PRICING.email);
    logUsage(userEmail, plan, "app", PRICING.app);
    checkAndTopUp(userEmail, plan);

    // Unknown => email notification
    if (faces.length === 0) {
      await sendAlertEmail(
        userEmail,
        CONFIG.ALERT_SUBJECT,
        `🚨 Unknown face detected at ${new Date().toLocaleString()}<br/><br/>Image key: ${key}`
      );
    }

    res.json({ ok: true, faces, key });
  } catch (err) {
    console.error("⚠️ /trigger-alert error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    // cleanup temp file
    try { fs.unlinkSync(req?.file?.path); } catch {}
  }
});

// ===== Shira Assistant =====
app.post("/shira", (req, res) => {
  const msg = (req.body.message || "").toLowerCase();
  let reply = "👋 Hi, I’m Shira — your SpotAlert assistant. How can I help you today?";
  if (msg.includes("plan")) reply = "💡 Plans: Free, Standard, Premium, Elite.";
  else if (msg.includes("trial")) reply = "🎁 14-day free trial before billing.";
  else if (msg.includes("camera")) reply = "📷 Connect multiple cameras per your plan.";
  else if (msg.includes("alert")) reply = "🚨 Alerts fire instantly on unknown faces.";
  else if (msg.includes("privacy")) reply = "🔒 Your data is encrypted and stored securely.";
  else if (msg.includes("contact")) reply = "📧 Reach us at admin@spotalert.live.";
  res.json({ reply });
});

// ===========================================================
// ELITE FEATURES (aligned to your dashboard code)
// ===========================================================

// 1) Replay — returns frames within the last X minutes
app.get("/api/elite/replay", (req, res) => {
  const mins = parseInt(req.query.minutes || "10", 10);
  db.all(
    "SELECT timestamp, image as key FROM alerts WHERE timestamp >= datetime('now', ?) ORDER BY timestamp ASC",
    [`-${mins} minutes`],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const frames = rows.map(r => ({ key: r.key, ts: r.timestamp }));
      res.json({ frames });
    }
  );
});

// 2) Frame URL — presigned S3 URL (query ?key=…)
app.get("/api/elite/frame-url", async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: "Missing key" });
  try {
    const cmd = new GetObjectCommand({ Bucket: CONFIG.S3_BUCKET, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3) Incident PDF — simple downloadable PDF of last 10 alerts
app.get("/api/elite/incident-pdf", (req, res) => {
  db.all("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 10", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    res.setHeader("Content-Disposition", "attachment; filename=SpotAlert_Incident_Report.pdf");
    res.setHeader("Content-Type", "application/pdf");

    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(18).text("SpotAlert Incident Report", { align: "center" });
    doc.moveDown();

    rows.forEach((r, i) => {
      doc.fontSize(12).text(`${i + 1}. ${r.timestamp} — ${r.type} — key: ${r.image}`);
    });

    doc.moveDown().fontSize(10).text("Generated automatically by SpotAlert.");
    doc.end();
  });
});

// ===========================================================
// BILLING/USAGE ENDPOINTS
// ===========================================================

app.get("/api/usage-summary", (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Missing email" });

  const since = new Date(); since.setDate(1);
  const sinceISO = since.toISOString();

  db.all(
    "SELECT channel, COUNT(*) as count, SUM(cost_usd) as total FROM usage_log WHERE user_email = ? AND timestamp >= ? GROUP BY channel",
    [email, sinceISO],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const total = rows.reduce((a, b) => a + (b.total || 0), 0);
      res.json({
        email,
        month: new Date().toISOString().slice(0, 7),
        total_cost_usd: Number(total.toFixed(3)),
        details: rows
      });
    }
  );
});

app.post("/api/usage-reset", (_, res) => {
  db.run("DELETE FROM usage_log", (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, message: "Usage log reset successful." });
  });
});

app.get("/api/usage-export", (_, res) => {
  db.all("SELECT * FROM usage_log", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    let csv = "id,user_email,plan,channel,cost_usd,timestamp\n";
    rows.forEach(r => {
      csv += `${r.id},${r.user_email},${r.plan},${r.channel},${r.cost_usd},${r.timestamp}\n`;
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=usage.csv");
    res.send(csv);
  });
});

// ===========================================================
// START
// ===========================================================
app.listen(CONFIG.PORT, () => {
  console.log(`✅ SpotAlert running on port ${CONFIG.PORT}`);
});
