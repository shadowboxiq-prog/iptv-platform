import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { db } from '../db/index.js';

/**
 * Authentication middleware for Admin API routes.
 */
export function requireAdmin(req, res, next) {
  let token = null;

  // Check cookie first
  if (req.cookies && req.cookies.admin_token) {
    token = req.cookies.admin_token;
  } else if (req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({ 
      ok: false, 
      error: 'غير مصرح بالدخول، يرجى تسجيل الدخول كمدير' 
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const stmt = db.prepare('SELECT id, username, email, role, locked_until FROM admins WHERE id = ?');
    const admin = stmt.get(decoded.id);

    if (!admin) {
      return res.status(401).json({ 
        ok: false, 
        error: 'حساب المدير لم يعد موجوداً' 
      });
    }

    if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
      return res.status(403).json({ 
        ok: false, 
        error: 'هذا الحساب مغلق مؤقتاً بسبب كثرة محاولات الدخول الخاطئة' 
      });
    }

    // CSRF protection for mutating requests when cookie is used
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.cookies?.admin_token) {
      const customHeader = req.headers['x-requested-with'] || req.headers['x-admin-action'];
      if (!customHeader) {
        return res.status(403).json({
          ok: false,
          error: 'فشل التحقق من أمان الطلب (CSRF Protection)'
        });
      }
    }

    req.admin = {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role
    };

    next();
  } catch (err) {
    return res.status(401).json({ 
      ok: false, 
      error: 'جلسة الدخول منتهية أو غير صالحة' 
    });
  }
}
