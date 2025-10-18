// ===========================================================
//  SpotAlert AWS Backend Server — FINAL BUILD (Elite + Billing)
//  Version: v3.0 – October 2025
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
import {
  SESClient,
  SendEmailCommand
} from "@aws-sdk/client-ses";

// ===========================================================
// CONFIGURATION
// ===========================================================
const CONFIG = {
  PORT: 3000,
  AWS_REGION: "us-east-1",
  S3_BUCKET: "spotalert",
  REKOG_COLLECTION_ID: "SpotAlertCollection",
  SES_FROM_EMAIL: "alerts@spotalert.live",
  SES_TO_EMAIL: "admin@spotalert.live",
  ALERT_SUBJECT: "[SpotAlert] Unknown Face Detected",
};

// ===========================================================
// COST CONFIGURATION
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
// EXPRESS SETUP
// ===========================================================
const app = express();
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json());
app.use(express.static("public"));

// ===========================================================
// DATABASE SETUP
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
// FILE UPLOAD CONFIG
// ===========================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ===========================================================
// HELPERS
// ===========================================================

// ===== Upload to S3 =====
async function uploadToS3(localPath, key) {
  const buffer = fs.readFileSync(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: CONFIG.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    })
  );
  console.log(`✅ Uploaded to S3: ${CONFIG.S3_BUCKET}/${key}`);
  return key;
}

// ===== Detect Faces =====
async function detectFaces(localPath) {
  try {
    const collections = await rekog.send(new ListCollectionsCommand({}));
    if (!collections.CollectionIds.includes(CONFIG.REKOG_COLLECTION_ID)) {
      await rekog.send(
        new CreateCollectionCommand({ CollectionId: CONFIG.REKOG_COLLECTION_ID })
      );
      console.log(`🆕 Created collection: ${CONFIG.REKOG_COLLECTION_ID}`);
    }

    const img = fs.readFileSync(localPath);
    const res = await rekog.send(
      new SearchFacesByImageCommand({
        CollectionId: CONFIG.REKOG_COLLECTION_ID,
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

// ===== Send Email =====
async function sendAlertEmail(to, subject, msg) {
  try {
    await ses.send(
      new SendEmailCommand({
        Destination: { ToAddresses: [to || CONFIG.SES_TO_EMAIL] },
        Source: CONFIG.SES_FROM_EMAIL,
        Message: {
          Subject: { Data: subject || CONFIG.ALERT_SUBJECT },
          Body: {
            Html: { Data: `<p>${msg}</p><p><small>Sent by SpotAlert</small></p>` },
          },
        },
      })
    );
    console.log(`📨 Email sent to ${to}`);
  } catch (err) {
    console.error("⚠️ SES Error:", err.message);
  }
}

// ===== Log Usage =====
function logUsage(user, plan, channel, cost) {
  db.run(
    "INSERT INTO usage_log (user_email, plan, channel, cost_usd, timestamp) VALUES (?, ?, ?, ?, ?)",
    [user, plan, channel, cost, new Date().toISOString()]
  );
  console.log(`💾 Usage logged: ${channel} - $${cost.toFixed(3)}`);
}

// ===== Check Usage Limit =====
function checkAndTopUp(user, plan) {
  const since = new Date();
  since.setDate(1);
  const sinceISO = since.toISOString();

  db.get(
    "SELECT SUM(cost_usd) as total FROM usage_log WHERE user_email = ? AND timestamp >= ?",
    [user, sinceISO],
    (err, row) => {
      if (row && row.total && row.total > PLAN_LIMITS[plan]) {
        console.log(`⚠️ ${user} exceeded ${plan} quota — prompt top-up.`);
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

// ===== HOME =====
app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) =>
  res.sendFile("dashboard.html", { root: "public" })
);

// ===== HEALTH CHECK =====
app.get("/health", (_, res) =>
  res.json({ status: "ok", time: new Date().toISOString() })
);

// ===== TRIGGER ALERT =====
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;
    const plan = req.body.plan || "Free";
    const userEmail = req.body.email || CONFIG.SES_TO_EMAIL;

    await uploadToS3(imagePath, key);
    const faces = await detectFaces(imagePath);

    const alertType = faces.length > 0 ? "known_face" : "unknown_face";
    db.run("INSERT INTO alerts (type, timestamp, image) VALUES (?, ?, ?)", [
      alertType,
      new Date().toISOString(),
      key,
    ]);

    // simulate channels used (email + app for now)
    logUsage(userEmail, plan, "email", PRICING.email);
    logUsage(userEmail, plan, "app", PRICING.app);

    checkAndTopUp(userEmail, plan);

    if (faces.length === 0) {
      await sendAlertEmail(
        userEmail,
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

// ===== SHIRA ASSISTANT =====
app.post("/shira", (req, res) => {
  const msg = (req.body.message || "").toLowerCase();
  let reply =
    "👋 Hi, I’m Shira — your SpotAlert assistant. How can I help you today?";

  if (msg.includes("plan"))
    reply =
      "💡 SpotAlert offers multiple plans — Free, Standard, Premium, and Elite.";
  else if (msg.includes("trial"))
    reply = "🎁 You get a 14-day free trial before your first billing.";
  else if (msg.includes("camera"))
    reply = "📷 You can connect multiple cameras depending on your subscription.";
  else if (msg.includes("alert"))
    reply = "🚨 Alerts are sent instantly when an unknown face is detected.";
  else if (msg.includes("privacy"))
    reply = "🔒 All data is encrypted and stored securely.";
  else if (msg.includes("contact"))
    reply = "📧 Contact support anytime at admin@spotalert.live.";

  res.json({ reply });
});

// ===========================================================
// ELITE FEATURES
// ===========================================================

// ===== Replay (fetch last 10 alerts) =====
app.get("/api/elite/replay", (_, res) => {
  db.all("SELECT * FROM alerts ORDER BY id DESC LIMIT 10", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ===== Frame URL (presigned) =====
app.get("/api/elite/frame-url/:key", async (req, res) => {
  try {
    const command = new GetObjectCommand({
      Bucket: CONFIG.S3_BUCKET,
      Key: req.params.key,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Incident PDF =====
app.get("/api/elite/incident-pdf/:id", (req, res) => {
  db.get("SELECT * FROM alerts WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row)
      return res.status(404).json({ error: "Incident not found." });

    const doc = new PDFDocument();
    res.setHeader("Content-Disposition", "attachment; filename=incident.pdf");
    res.setHeader("Content-Type", "application/pdf");

    doc.fontSize(20).text("SpotAlert Incident Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(14).text(`Type: ${row.type}`);
    doc.text(`Timestamp: ${row.timestamp}`);
    doc.text(`Image: ${row.image}`);
    doc.moveDown().fontSize(10).text("Generated automatically by SpotAlert.");
    doc.pipe(res);
    doc.end();
  });
});

// ===========================================================
// BILLING ENDPOINTS
// ===========================================================

// ===== Usage Summary =====
app.get("/api/usage-summary", (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Missing email" });

  const since = new Date();
  since.setDate(1);
  const sinceISO = since.toISOString();

  db.all(
    "SELECT channel, COUNT(*) as count, SUM(cost_usd) as total FROM usage_log WHERE user_email = ? AND timestamp >= ? GROUP BY channel",
    [email, sinceISO],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const totalCost = rows.reduce((a, b) => a + (b.total || 0), 0);
      res.json({
        email,
        month: new Date().toISOString().slice(0, 7),
        total_cost_usd: totalCost.toFixed(3),
        details: rows,
      });
    }
  );
});

// ===== Reset Usage =====
app.post("/api/usage-reset", (_, res) => {
  db.run("DELETE FROM usage_log", (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, message: "Usage log reset successful." });
  });
});

// ===== Export Usage CSV =====
app.get("/api/usage-export", (_, res) => {
  db.all("SELECT * FROM usage_log", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    let csv = "id,user_email,plan,channel,cost_usd,timestamp\n";
    rows.forEach((r) => {
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
  console.log(`✅ SpotAlert running on port ${CONFIG.PORT}`);
});
