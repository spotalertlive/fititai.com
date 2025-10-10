// ===============================
// SpotAlert AWS Backend Server
// ===============================
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sqlite3 from "sqlite3";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { uploadToS3, detectFaces, sendAlertEmail } from "./spotalert_aws_link.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ===== SQLite local log =====
const db = new sqlite3.Database("spotalert.db");
db.run("CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, timestamp TEXT, image TEXT)");

// ===== Folder paths =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ===== ROUTES =====
app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public" }));
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ===== Trigger Rekognition =====
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const email = req.body.email || process.env.ADMIN_EMAIL;
    const imagePath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;
    await uploadToS3(imagePath, key);
    const faces = await detectFaces(process.env.S3_BUCKET, key);
    db.run("INSERT INTO alerts (type,timestamp,image) VALUES (?,?,?)",
           ["unknown_face", new Date().toISOString(), key]);
    await sendAlertEmail(
      email,
      "SpotAlert Detection Notice",
      `✅ Detected ${faces.length} face(s) in latest upload.\n\nImage: ${key}`
    );
    res.json({ ok: true, faces, key });
  } catch (err) {
    console.error("⚠️ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SpotAlert running at http://localhost:${PORT}`);
});
