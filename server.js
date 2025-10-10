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
const db = new sqlite3.Database("spotalert.db");
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// storage folder for uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, "uploads/") });

db.run("CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, timestamp TEXT, image TEXT)");

app.get("/", (_, res) => res.sendFile("index.html", { root: "public" }));
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));
app.get("/dashboard", (_, res) => res.sendFile("dashboard.html", { root: "public" }));

app.post("/trigger-alert", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const email = req.body.email;
    const key = `uploads/${Date.now()}_${req.file.originalname}`;
    await uploadToS3(imagePath, key);
    const faces = await detectFaces(process.env.S3_BUCKET, key);
    db.run("INSERT INTO alerts (type,timestamp,image) VALUES (?,?,?)",
           ["unknown_face", new Date().toISOString(), key]);
    await sendAlertEmail(email, "SpotAlert Detection", `Detected ${faces.length} face(s).`);
    res.json({ ok:true, faces, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`✅ SpotAlert running on port ${PORT}`));
