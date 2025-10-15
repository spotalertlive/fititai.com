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

// ===== Middleware =====
app.use(cors({
  origin: ["https://spotalert.live", "http://localhost:3000"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());
app.use(express.static("public"));

// ===== SQLite Database =====
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

// ===== ROUTES =====
app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public" }));

// ===== Health & Version =====
app.get("/health", (_, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/version", (_, res) => {
  res.json({
    name: "SpotAlert Backend",
    version: "1.0.0",
    uptime: process.uptime().toFixed(1) + "s",
    environment: process.env.NODE_ENV || "development"
  });
});

// ===== Image Detection & Email Alert =====
app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const email = req.body.email || process.env.SES_TO_EMAIL;
    const imagePath = req.file.path;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;

    await uploadToS3(imagePath, key);
    const faces = await detectFaces(process.env.S3_BUCKET, key);

    db.run(
      "INSERT INTO alerts (type, timestamp, image) VALUES (?, ?, ?)",
      [faces.length > 0 ? "known_face" : "unknown_face", new Date().toISOString(), key]
    );

    if (faces.length === 0) {
      await sendAlertEmail(
        email,
        "[SpotAlert] Unknown Face Detected",
        `🚨 An unknown face was detected at ${new Date().toLocaleString()}.\n\nImage: ${key}`
      );
    }

    res.json({ ok: true, faces, key });
  } catch (err) {
    console.error("⚠️ Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===== 🧠 Shira Assistant Endpoint =====
app.post("/shira", async (req, res) => {
  try {
    const { message } = req.body;
    const lower = (message || "").toLowerCase();

    let reply = "👋 Hi, I’m Shira — your SpotAlert assistant. How can I help you today?";

    if (lower.includes("plan") || lower.includes("price"))
      reply = "💡 SpotAlert offers monthly and yearly plans — you can monitor 2, 4, or up to 10 cameras depending on your subscription.";
    else if (lower.includes("trial"))
      reply = "🎁 Every new SpotAlert user gets a 14-day free trial before choosing a plan.";
    else if (lower.includes("camera"))
      reply = "📷 You can connect multiple cameras. Each plan limits the number of active camera feeds for best performance.";
    else if (lower.includes("alert"))
      reply = "🚨 SpotAlert sends instant alerts for unknown faces via email, SMS, or WhatsApp depending on your preferences.";
    else if (lower.includes("privacy"))
      reply = "🔒 Your video data is encrypted and never shared — SpotAlert follows strict data privacy and security policies.";
    else if (lower.includes("contact"))
      reply = "📧 You can reach the SpotAlert team anytime at admin@spotalert.live.";
    else if (lower.includes("help") || lower.includes("support"))
      reply = "🤖 Sure! For setup help or troubleshooting, visit spotalert.live/contact.html or email admin@spotalert.live.";

    res.json({ reply });
  } catch (err) {
    console.error("❌ Shira Error:", err);
    res.status(500).json({ reply: "⚠️ Sorry, something went wrong. Please try again later." });
  }
});

// ===== Global Error Handler =====
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ===== Start Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SpotAlert running on http://localhost:${PORT}`);
});
