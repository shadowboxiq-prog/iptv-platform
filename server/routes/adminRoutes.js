import express from 'express';
import { db } from '../db/index.js';
import { requireAdmin } from '../middleware/authMiddleware.js';
import { getAuditLogs, logAudit } from '../services/auditService.js';

const router = express.Router();
router.use(requireAdmin);

/**
 * Get aggregated dashboard statistics
 */
router.get('/dashboard/stats', (req, res) => {
  try {
    const totalChannels = db.prepare('SELECT COUNT(*) as c FROM channels').get().c;
    const activeChannels = db.prepare('SELECT COUNT(*) as c FROM channels WHERE is_active = 1').get().c;
    const inactiveChannels = totalChannels - activeChannels;

    const totalSources = db.prepare('SELECT COUNT(*) as c FROM stream_sources').get().c;
    const activeSources = db.prepare('SELECT COUNT(*) as c FROM stream_sources WHERE is_active = 1').get().c;
    const sourcesWithErrors = db.prepare("SELECT COUNT(*) as c FROM stream_sources WHERE last_checked_status = 'error'").get().c;

    const sourcesByType = db.prepare(`
      SELECT type, COUNT(*) as count 
      FROM stream_sources 
      GROUP BY type
    `).all();

    const topCategories = db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM channels 
      GROUP BY category 
      ORDER BY count DESC 
      LIMIT 6
    `).all();

    const recentLogs = getAuditLogs(10, 0);

    res.json({
      ok: true,
      stats: {
        totalChannels,
        activeChannels,
        inactiveChannels,
        totalSources,
        activeSources,
        sourcesWithErrors,
        sourcesByType,
        topCategories,
        recentLogs
      }
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل إحصائيات لوحة التحكم' });
  }
});

/**
 * Get audit logs
 */
router.get('/audit-logs', (req, res) => {
  const { limit = 50, page = 1 } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    const total = db.prepare('SELECT COUNT(*) as total FROM audit_logs').get().total;
    const logs = getAuditLogs(limitNum, offset);

    res.json({
      ok: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء تحميل سجلات النشاط' });
  }
});

/**
 * Get system settings
 */
router.get('/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء جلب الإعدادات' });
  }
});

/**
 * Update system settings
 */
router.put('/settings', (req, res) => {
  const { settings } = req.body;

  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ ok: false, error: 'بيانات الإعدادات غير صالحة' });
  }

  const now = new Date().toISOString();
  const upsertStmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) 
    VALUES (?, ?, ?) 
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const tx = db.transaction((settingsObj) => {
    for (const [key, val] of Object.entries(settingsObj)) {
      upsertStmt.run(key, String(val), now);
    }
  });

  tx(settings);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'UPDATE_SETTINGS',
    details: settings,
    ipAddress: req.ip
  });

  res.json({ ok: true, message: 'تم حفظ الإعدادات بنجاح' });
});

export default router;
