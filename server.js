import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import sqlite3 from "sqlite3";
import { uploadToS3, detectFaces, sendAlertEmail } from "./spotalert_aws_link.js";

dotenv.config();
const app = express();
const db = new sqlite3.Database("spotalert.db");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

db.run("CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, timestamp TEXT, image TEXT)");

app.get("/", (req, res) => res.sendFile("index.html", { root: "public" }));

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Example endpoint to simulate alert
app.post("/trigger-alert", async (req, res) => {
  try {
    const { imagePath, email } = req.body;
    const key = `captures/${Date.now()}.jpg`;
    await uploadToS3(imagePath, key);
    const faces = await detectFaces(process.env.S3_BUCKET, key);
    db.run("INSERT INTO alerts (type, timestamp, image) VALUES (?,?,?)",
           ["unknown_face", new Date().toISOString(), key]);
    await sendAlertEmail(email, "SpotAlert Detection", `Detected ${faces.length} faces.`);
    res.json({ ok: true, faces });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ SpotAlert running on port ${PORT}`));
