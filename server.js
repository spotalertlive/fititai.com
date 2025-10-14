// ===============================
// SpotAlert AWS Backend Server (Final)
// ===============================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import multer from "multer";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { uploadToS3, detectFaces, sendAlertEmail } from "./spotalert_aws_link.js";
import { createVerificationToken, verifyToken } from "./utils/tokenManager.js";
import { sendEmail } from "./utils/sendEmail.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// === DB Setup ===
const db = new sqlite3.Database("spotalert.db");
db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, verified INTEGER DEFAULT 0)");
db.run("CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, type TEXT, timestamp TEXT, image TEXT)");

// === File Setup ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// === ROUTES ===

// --- Health check
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// --- Signup
app.post("/signup", async (req, res) => {
  const { name, email, password } = req.body;
  const token = createVerificationToken(email);
  const verifyUrl = `${process.env.BASE_URL}/verify?token=${token}`;
  const htmlPath = path.join(__dirname, "emails/verify.html");

  try {
    db.run("INSERT INTO users (name,email,password) VALUES (?,?,?)", [name, email, password]);
    await sendEmail(email, "Verify your SpotAlert account", htmlPath, { verify_url: verifyUrl, first_name: name });
    res.json({ success: true, message: "Verification email sent." });
  } catch {
    res.status(400).json({ success: false, message: "User already exists or error sending email." });
  }
});

// --- Verify email
app.get("/verify", (req, res) => {
  const decoded = verifyToken(req.query.token);
  if (!decoded) return res.sendFile(path.join(__dirname, "emails/verify-expired.html"));
  db.run("UPDATE users SET verified=1 WHERE email=?", [decoded.email]);
  res.sendFile(path.join(__dirname, "emails/verified-success.html"));
});

// --- Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email=? AND password=?", [email, password], (err, row) => {
    if (err || !row) return res.status(401).json({ success: false, message: "Invalid email or password." });
    if (!row.verified) return res.status(403).json({ success: false, message: "Please verify your email first." });
    res.json({ success: true });
  });
});

// --- Trigger Alert (AWS Rekognition)
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const email = req.body.email || process.env.SES_TO_EMAIL;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;
    await uploadToS3(req.file.path, key);
    const faces = await detectFaces(process.env.S3_BUCKET, key);
    db.run("INSERT INTO alerts (type,timestamp,image) VALUES (?,?,?)", ["unknown_face", new Date().toISOString(), key]);
    await sendAlertEmail(email, "SpotAlert Detection Notice", `Detected ${faces.length} face(s).`);
    res.json({ ok: true, faces, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ SpotAlert backend running on port ${PORT}`));
