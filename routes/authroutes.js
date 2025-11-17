import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendEmail } from '../utils/sendEmail.js';
import { createVerificationToken, verifyToken } from '../utils/tokenManager.js';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 🔗 FINAL BACKEND BASE URL (Production-Safe)
// ============================================================
//
// PRIORITY:
// 1. BASE_URL from .env (best for domains)
// 2. Production → your FINAL EC2 IP
// 3. Development → localhost
//
const BACKEND_BASE =
  process.env.BASE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://54.159.59.142:3000"   // FINAL, REAL backend IP
    : "http://localhost:3000");

console.log("🌐 Using BACKEND_BASE:", BACKEND_BASE);

// ============================================================
// SIGNUP
// ============================================================
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    // 1. Create verification token
    const token = createVerificationToken(email);
    if (!token) {
      return res.status(500).json({ error: "Failed to create verification token." });
    }

    // 2. Build verification URL
    const verifyUrl = `${BACKEND_BASE}/api/auth/verify?token=${token}`;
    console.log("🔗 Verification URL:", verifyUrl);

    // 3. Send verification email
    await sendEmail(
      email,
      "Welcome to SpotAlert – Verify Your Account",
      path.join(__dirname, "../emails/verify.html"),
      { verify_url: verifyUrl, first_name: name }
    );

    console.log(`✅ Signup email sent to: ${email}`);

    res.json({
      success: true,
      message: "Account created! Check your email to verify."
    });

  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ error: "Signup failed. Please try again." });
  }
});

// ============================================================
// VERIFY EMAIL
// ============================================================
router.get('/verify', (req, res) => {
  const token = req.query.token;

  const decoded = verifyToken(token);

  if (!decoded) {
    console.warn("⚠️ Invalid or expired verification token");
    return res.sendFile(path.join(__dirname, "../emails/verify-expired.html"));
  }

  console.log(`✅ Email verified: ${decoded.email}`);

  return res.sendFile(path.join(__dirname, "../emails/verified-success.html"));
});

// ============================================================
// RESEND VERIFICATION
// ============================================================
router.post('/resend', async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ error: "Email is required." });

  try {
    const token = createVerificationToken(email);
    const verifyUrl = `${BACKEND_BASE}/api/auth/verify?token=${token}`;

    await sendEmail(
      email,
      "Verify your SpotAlert account",
      path.join(__dirname, "../emails/verify.html"),
      { verify_url: verifyUrl, first_name: "User" }
    );

    console.log(`📨 Resent verification to: ${email}`);

    res.json({
      success: true,
      message: "Verification email sent."
    });

  } catch (err) {
    console.error("❌ Resend error:", err);
    res.status(500).json({ error: "Failed to resend verification email." });
  }
});

export default router;
