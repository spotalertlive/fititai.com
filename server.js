// ===========================================
// SpotAlert AWS Backend – Final Production
// ===========================================
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { uploadToS3, detectFaces, sendAlertEmail } from "./spotalert_aws_link.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// --- Local DB Log (for alert history)
const db = new sqlite3.Database("spotalert.db");
db.run(`CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  timestamp TEXT,
  image TEXT
)`);

// --- Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// --- Routes
app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public/dashboard" }));
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// --- Trigger AWS Rekognition + Email Alert
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const email = req.body.email || process.env.SES_TO_EMAIL;
    const imagePath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;

    // Upload & detect
    await uploadToS3(imagePath, key);
    const faces = await detectFaces(process.env.S3_BUCKET, key);

    // Save to local DB
    db.run("INSERT INTO alerts (type, timestamp, image) VALUES (?,?,?)",
      ["unknown_face", new Date().toISOString(), key]
    );

    // Send email only if no matches found
    if (!faces || faces.length === 0) {
      await sendAlertEmail(
        email,
        "SpotAlert – Unknown Person Detected",
        `🚨 An unknown person was detected.\n\nSnapshot: ${key}`
      );
    }

    res.json({ ok: true, faces, key });
  } catch (err) {
    console.error("⚠️ Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SpotAlert backend running on port ${PORT}`);
});
