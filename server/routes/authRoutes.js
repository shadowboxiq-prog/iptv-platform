import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { config } from '../config/index.js';
import { logAudit } from '../services/auditService.js';
import { loginRateLimiter, recordFailedAttempt, resetAttempts } from '../middleware/rateLimiter.js';
import { requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Check admin setup and session status.
 */
router.get('/status', (req, res) => {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM admins');
  const adminCount = countStmt.get().count;

  let isAuthenticated = false;
  let adminData = null;

  const token = req.cookies?.admin_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      const adminStmt = db.prepare('SELECT id, username, email, role FROM admins WHERE id = ?');
      const admin = adminStmt.get(decoded.id);
      if (admin) {
        isAuthenticated = true;
        adminData = admin;
      }
    } catch {
      // Invalid/expired token
    }
  }

  res.json({
    ok: true,
    requiresSetup: adminCount === 0,
    isAuthenticated,
    admin: adminData
  });
});

/**
 * Initial setup route to create the very first admin safely.
 * Only works if NO admins currently exist.
 */
router.post('/setup', async (req, res) => {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM admins');
  const adminCount = countStmt.get().count;

  if (adminCount > 0) {
    return res.status(403).json({
      ok: false,
      error: 'تم إعداد المدير مسبقاً. لا يمكن إنشاء حساب جديد عبر هذه الواجهة.'
    });
  }

  const { username, email, password, setupToken } = req.body;

  // Validate setupToken if configured
  if (config.setupToken && setupToken !== config.setupToken) {
    return res.status(403).json({
      ok: false,
      error: 'رمز إعداد المدير الأولي (Setup Token) غير صحيح'
    });
  }

  if (!username || username.trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'اسم المستخدم يجب أن يتكون من 3 أحرف على الأقل' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ ok: false, error: 'كلمة المرور يجب أن تتكون من 8 خانات على الأقل' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const adminId = uuidv4();
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO admins (id, username, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', ?, ?)
    `);

    insertStmt.run(adminId, username.trim().toLowerCase(), email?.trim() || null, passwordHash, now, now);

    logAudit({
      adminId,
      adminUsername: username,
      action: 'ADMIN_SETUP_INITIAL',
      details: { message: 'First administrator initialized successfully' },
      ipAddress: req.ip
    });

    res.json({
      ok: true,
      message: 'تم إنشاء حساب المدير بنجاح. يمكنك الآن تسجيل الدخول.'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء إنشاء حساب المدير' });
  }
});

/**
 * Admin Login
 */
router.post('/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  const cleanUsername = String(username).toLowerCase().trim();
  const stmt = db.prepare('SELECT * FROM admins WHERE username = ?');
  const admin = stmt.get(cleanUsername);

  if (!admin) {
    recordFailedAttempt(req.rateLimitKey);
    logAudit({
      adminUsername: cleanUsername,
      action: 'LOGIN_FAILED',
      details: { reason: 'User not found' },
      ipAddress: req.ip
    });
    return res.status(401).json({ ok: false, error: 'بيانات تسجيل الدخول غير صحيحة' });
  }

  const isPasswordValid = await bcrypt.compare(password, admin.password_hash);
  if (!isPasswordValid) {
    recordFailedAttempt(req.rateLimitKey);
    logAudit({
      adminId: admin.id,
      adminUsername: cleanUsername,
      action: 'LOGIN_FAILED',
      details: { reason: 'Incorrect password' },
      ipAddress: req.ip
    });
    return res.status(401).json({ ok: false, error: 'بيانات تسجيل الدخول غير صحيحة' });
  }

  // Reset rate limiting counter on success
  resetAttempts(req.rateLimitKey);

  // Generate session JWT (valid for 24 hours)
  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  // Set secure HTTP-only cookie
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  logAudit({
    adminId: admin.id,
    adminUsername: admin.username,
    action: 'LOGIN_SUCCESS',
    ipAddress: req.ip
  });

  res.json({
    ok: true,
    token, // Also returned for Authorization header support
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role
    }
  });
});

/**
 * Admin Logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true, message: 'تم تسجيل الخروج بنجاح' });
});

/**
 * Change Admin Password
 */
router.post('/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ ok: false, error: 'كلمة المرور الجديدة يجب أن تكون 8 خانات على الأقل' });
  }

  const stmt = db.prepare('SELECT password_hash FROM admins WHERE id = ?');
  const admin = stmt.get(req.admin.id);

  const isValid = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!isValid) {
    return res.status(400).json({ ok: false, error: 'كلمة المرور الحالية غير صحيحة' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const updateStmt = db.prepare('UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?');
  updateStmt.run(newHash, new Date().toISOString(), req.admin.id);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'PASSWORD_CHANGED',
    ipAddress: req.ip
  });

  res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح' });
});

export default router;
