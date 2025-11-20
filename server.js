// ===========================================================
//  SpotAlert AWS Backend — FINAL CONSOLIDATED (v3.4)
//  Fully compatible with dashboard + script.js
//  Uses .env for AWS + Gmail + JWT
// ===========================================================

import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";
dotenv.config();

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

// 🔐 Auth routes (signup, verify, resend)
import authRoutes from "./routes/authroutes.js";

// ===========================================================
// CONFIG
// ===========================================================
const CONFIG = {
  PORT: Number(process.env.PORT || 3000),
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET || "spotalert",
  REKOG_COLLECTION_ID: process.env.REKOG_COLLECTION_ID || "SpotAlertCollection",

  SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || "aispotalert@gmail.com",
  SES_TO_EMAIL: process.env.SES_TO_EMAIL || "aispotalert@gmail.com",

  ALERT_SUBJECT: process.env.ALERT_SUBJECT || "[SpotAlert] Unknown Face Detected",
};

// ===========================================================
// COST & PLAN LIMITS
// ===========================================================
const PRICING = {
  app: 0.001,
  email: 0.002,
  whatsapp: 0.006,
  sms: 0.005,
};

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

// Static public folder (optional if frontend is separate)
app.use(express.static("public"));

// Mount auth routes
app.use("/api/auth", authRoutes);

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

// make sure uploads/ exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const upload = multer({ dest: uploadsDir });

// ===========================================================
// HELPERS
// ===========================================================

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

async function sendAlertEmail(to, subject, html) {
  try {
    await ses.send(new SendEmailCommand({
      Destination: { ToAddresses: [to || CONFIG.SES_TO_EMAIL] },
      Source: CONFIG.SES_FROM_EMAIL,
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: html } }
      }
    }));
  } catch (err) {
    console.error("⚠️ SES Error:", err.message);
  }
}

function logUsage(user, plan, channel, cost) {
  db.run(
    "INSERT INTO usage_log (user_email, plan, channel, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?)",
    [user, plan, channel, cost, new Date().toISOString()]
  );
}

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
          `Your monthly alert usage exceeded your ${plan} plan limit.`
        );
      }
    }
  );
}

// ===========================================================
// ROUTES – PAGES (optional if frontend separate)
// ===========================================================
app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public" }));

// ===========================================================
// STATUS / HEALTH
// ===========================================================
app.get("/health", (_, res) =>
  res.json({ ok: true, status: "ok", time: new Date().toISOString() })
);

app.get("/api/status", (_, res) =>
  res.json({ ok: true, status: "ok", time: new Date().toISOString() })
);

app.get("/api/health", (_, res) =>
  res.json({ ok: true, status: "ok", time: new Date().toISOString() })
);

// ===========================================================
// ALERT TRIGGER
// ===========================================================
async function handleTriggerAlert(req, res) {
  try {
    const localPath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;
    const plan = (req.body.plan || "Free");
    const userEmail = (req.body.email || CONFIG.SES_TO_EMAIL);

    const faces = await detectFaces(localPath);
    await uploadToS3(localPath, key);

    const type = faces.length > 0 ? "known_face" : "unknown_face";

    db.run(
      "INSERT INTO alerts (type, timestamp, image) VALUES (?, ?, ?)",
      [type, new Date().toISOString(), key]
    );

    logUsage(userEmail, plan, "email", PRICING.email);
    logUsage(userEmail, plan, "app", PRICING.app);
    checkAndTopUp(userEmail, plan);

    if (faces.length === 0) {
      await sendAlertEmail(
        userEmail,
        "[SpotAlert] Unknown Face Detected",
        `🚨 Unknown face detected at ${new Date().toLocaleString()}<br/>Image key: ${key}`
      );
    }

    res.json({ ok: true, faces, key });
  } catch (err) {
    console.error("⚠️ /trigger-alert error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(req?.file?.path); } catch {}
  }
}

app.post("/trigger-alert", upload.single("image"), handleTriggerAlert);
app.post("/api/trigger-alert", upload.single("image"), handleTriggerAlert);

// ===========================================================
// ELITE FEATURES
// ===========================================================
app.get("/api/elite/replay", (req, res) => {
  const mins = parseInt(req.query.minutes || "10", 10);
  db.all(
    "SELECT * FROM alerts WHERE timestamp >= datetime('now', ?) ORDER BY timestamp DESC",
    [`-${mins} minutes`],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

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

    doc.end();
  });
});

// ===========================================================
// BILLING / USAGE
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
    res.json({ ok: true });
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
// START SERVER
// ===========================================================
app.listen(CONFIG.PORT, () => {
  console.log(`✅ SpotAlert backend running on port ${CONFIG.PORT}`);
});
