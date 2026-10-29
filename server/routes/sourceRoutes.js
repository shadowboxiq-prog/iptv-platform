import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { requireAdmin } from '../middleware/authMiddleware.js';
import { m3uUpload } from '../middleware/uploadMiddleware.js';
import { encrypt, decrypt, maskSecret, redactSensitiveData } from '../services/cryptoService.js';
import { safeFetch } from '../services/ssrfService.js';
import { parseM3U } from '../services/m3uService.js';
import { testXtreamConnection, fetchXtreamChannels } from '../services/xtreamService.js';
import { testStalkerConnection, fetchStalkerChannels } from '../services/stalkerService.js';
import { calculateSyncDiff, executeSync } from '../services/syncService.js';
import { logAudit } from '../services/auditService.js';

const router = express.Router();
router.use(requireAdmin);

/**
 * List all stream sources.
 * Credentials are never returned unmasked!
 */
router.get('/', (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT 
        s.id, s.name, s.type, s.endpoint, s.is_active,
        s.last_checked_at, s.last_checked_status, s.last_checked_message,
        s.last_sync_at, s.last_sync_status, s.created_at, s.updated_at,
        (SELECT COUNT(*) FROM channels WHERE source_id = s.id) as channel_count,
        (SELECT COUNT(*) FROM channels WHERE source_id = s.id AND is_active = 1) as active_channel_count
      FROM stream_sources s
      ORDER BY s.created_at DESC
    `);
    const sources = stmt.all();

    res.json({
      ok: true,
      sources: sources.map(s => ({
        ...s,
        endpoint: s.endpoint || '',
        hasCredentials: true // Flag to show credentials exist without exposing them
      }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء جلب مصادر البث' });
  }
});

/**
 * Get individual source details (credentials masked)
 */
router.get('/:id', (req, res) => {
  const stmt = db.prepare('SELECT * FROM stream_sources WHERE id = ?');
  const source = stmt.get(req.params.id);

  if (!source) {
    return res.status(404).json({ ok: false, error: 'المصدر غير موجود' });
  }

  let credsMasked = {};
  if (source.credentials_encrypted) {
    const decrypted = decrypt(source.credentials_encrypted, true);
    if (decrypted && typeof decrypted === 'object') {
      credsMasked = {
        username: decrypted.username || '',
        passwordMasked: decrypted.password ? '••••••••' : '',
        macMasked: decrypted.mac ? '••••••••' : '',
        tokenMasked: decrypted.token ? '••••••••' : ''
      };
    }
  }

  res.json({
    ok: true,
    source: {
      ...source,
      credentials: credsMasked
    }
  });
});

/**
 * Create a new stream source
 */
router.post('/', m3uUpload.single('file'), async (req, res) => {
  const { name, type, endpoint, username, password, mac, token, m3uContent } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'اسم المصدر مطلوب' });
  }

  if (!['stalker', 'xtream', 'm3u'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'نوع المصدر غير صالح' });
  }

  let cleanEndpoint = endpoint ? endpoint.trim() : '';
  let credentialsObj = {};

  if (type === 'xtream') {
    if (!cleanEndpoint || !username || !password) {
      return res.status(400).json({ ok: false, error: 'عنوان الخادم واسم المستخدم وكلمة المرور مطلوبة لـ Xtream Codes' });
    }
    credentialsObj = { username: username.trim(), password: password.trim() };
  } else if (type === 'stalker') {
    if (!cleanEndpoint) {
      return res.status(400).json({ ok: false, error: 'عنوان بوابة Stalker مطلوب' });
    }
    credentialsObj = {
      username: username ? username.trim() : '',
      password: password ? password.trim() : '',
      mac: mac ? mac.trim() : '',
      token: token ? token.trim() : ''
    };
  } else if (type === 'm3u') {
    // Either endpoint (URL) or uploaded file or direct m3uContent
    if (!cleanEndpoint && !req.file && !m3uContent) {
      return res.status(400).json({ ok: false, error: 'يلزم تزويد رابط قائمة M3U أو رفع ملف' });
    }
  }

  const sourceId = uuidv4();
  const now = new Date().toISOString();
  const encryptedCreds = Object.keys(credentialsObj).length > 0 ? encrypt(credentialsObj) : null;

  try {
    const insertStmt = db.prepare(`
      INSERT INTO stream_sources (
        id, name, type, endpoint, credentials_encrypted, is_active,
        last_checked_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'pending', ?, ?)
    `);

    insertStmt.run(sourceId, name.trim(), type, cleanEndpoint, encryptedCreds, now, now);

    logAudit({
      adminId: req.admin.id,
      adminUsername: req.admin.username,
      action: 'CREATE_SOURCE',
      entityType: 'stream_source',
      entityId: sourceId,
      details: { name, type, endpoint: cleanEndpoint },
      ipAddress: req.ip
    });

    // If an M3U file was uploaded with the creation request, parse and auto-import preview or channels
    if (type === 'm3u' && (req.file || m3uContent)) {
      const fileText = req.file ? req.file.buffer.toString('utf8') : m3uContent;
      try {
        const parsed = parseM3U(fileText);
        // Automatically save initial channels
        const result = executeSync(sourceId, parsed.channels, { autoActivate: false });
        return res.json({
          ok: true,
          message: `تم إضافة المصدر واستيراد ${result.newCount} قناة بنجاح (معطلة افتراضياً بانتظار المراجعة)`,
          sourceId,
          importedCount: result.newCount
        });
      } catch (parseErr) {
        return res.status(400).json({
          ok: false,
          error: `تم إنشاء المصدر لكن تعذر قراءة ملف القنوات: ${parseErr.message}`,
          sourceId
        });
      }
    }

    res.json({
      ok: true,
      message: 'تم إضافة مصدر البث بنجاح',
      sourceId
    });
  } catch (err) {
    console.error('Error creating source:', err);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء حفظ المصدر' });
  }
});

/**
 * Update an existing source
 */
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, endpoint, username, password, mac, token, isActive } = req.body;

  const existingStmt = db.prepare('SELECT * FROM stream_sources WHERE id = ?');
  const existing = existingStmt.get(id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: 'المصدر غير موجود' });
  }

  let encryptedCreds = existing.credentials_encrypted;

  // If new credentials were provided, merge or replace
  if (username || password || mac || token) {
    const currentCreds = existing.credentials_encrypted ? (decrypt(existing.credentials_encrypted, true) || {}) : {};
    const updatedCreds = {
      ...currentCreds,
      ...(username ? { username: username.trim() } : {}),
      ...(password && password !== '••••••••' ? { password: password.trim() } : {}),
      ...(mac && mac !== '••••••••' ? { mac: mac.trim() } : {}),
      ...(token && token !== '••••••••' ? { token: token.trim() } : {})
    };
    encryptedCreds = encrypt(updatedCreds);
  }

  const now = new Date().toISOString();
  const updateStmt = db.prepare(`
    UPDATE stream_sources SET
      name = COALESCE(?, name),
      endpoint = COALESCE(?, endpoint),
      credentials_encrypted = ?,
      is_active = COALESCE(?, is_active),
      updated_at = ?
    WHERE id = ?
  `);

  updateStmt.run(
    name?.trim() || null,
    endpoint?.trim() || null,
    encryptedCreds,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
    now,
    id
  );

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'UPDATE_SOURCE',
    entityType: 'stream_source',
    entityId: id,
    details: { name, endpoint, isActive },
    ipAddress: req.ip
  });

  res.json({ ok: true, message: 'تم تحديث بيانات المصدر بنجاح' });
});

/**
 * Delete a source and optionally its associated channels
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const { deleteChannels } = req.query;

  const sourceStmt = db.prepare('SELECT name FROM stream_sources WHERE id = ?');
  const source = sourceStmt.get(id);

  if (!source) {
    return res.status(404).json({ ok: false, error: 'المصدر غير موجود' });
  }

  if (deleteChannels === 'true') {
    db.prepare('DELETE FROM channels WHERE source_id = ?').run(id);
  } else {
    // Unlink channels so they remain archived/independent
    db.prepare('UPDATE channels SET source_id = NULL WHERE source_id = ?').run(id);
  }

  db.prepare('DELETE FROM stream_sources WHERE id = ?').run(id);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'DELETE_SOURCE',
    entityType: 'stream_source',
    entityId: id,
    details: { name: source.name, deletedChannels: deleteChannels === 'true' },
    ipAddress: req.ip
  });

  res.json({ ok: true, message: 'تم حذف المصدر بنجاح' });
});

/**
 * Helper to run connection test on a single stream source
 */
async function runSourceConnectionTest(source) {
  const creds = source.credentials_encrypted ? (decrypt(source.credentials_encrypted, true) || {}) : {};
  let testResult = { ok: false, error: 'نوع المصدر غير معروف' };

  try {
    if (source.type === 'xtream') {
      testResult = await testXtreamConnection(source.endpoint, creds.username, creds.password);
    } else if (source.type === 'stalker') {
      testResult = await testStalkerConnection(source.endpoint, creds);
    } else if (source.type === 'm3u') {
      if (!source.endpoint) {
        testResult = { ok: true, info: { note: 'قائمة M3U محلية (ملف مرفوع)' } };
      } else {
        const headRes = await safeFetch(source.endpoint, { method: 'GET', timeoutMs: 8000 });
        if (headRes.ok) {
          testResult = { ok: true, info: { status: `${headRes.status} ${headRes.statusText}` } };
        } else {
          testResult = { ok: false, error: `استجاب خادم القائمة برمز خطأ (${headRes.status})` };
        }
      }
    }
  } catch (err) {
    testResult = { ok: false, error: err.message };
  }

  const now = new Date().toISOString();
  const updateStatusStmt = db.prepare(`
    UPDATE stream_sources SET
      last_checked_at = ?,
      last_checked_status = ?,
      last_checked_message = ?,
      updated_at = ?
    WHERE id = ?
  `);

  updateStatusStmt.run(
    now,
    testResult.ok ? 'ok' : 'error',
    testResult.ok ? 'الاتصال سليم وقيد العمل' : testResult.error,
    now,
    source.id
  );

  return {
    sourceId: source.id,
    name: source.name,
    ok: testResult.ok,
    error: testResult.error,
    info: testResult.info
  };
}

/**
 * Test all active sources at once
 */
router.post('/test-all', async (req, res) => {
  try {
    const sources = db.prepare('SELECT * FROM stream_sources WHERE is_active = 1').all();
    const results = [];
    for (const source of sources) {
      const resItem = await runSourceConnectionTest(source);
      results.push(resItem);
    }

    logAudit({
      adminId: req.admin.id,
      adminUsername: req.admin.username,
      action: 'TEST_ALL_SOURCES',
      entityType: 'stream_source',
      details: { totalTested: sources.length, okCount: results.filter(r => r.ok).length },
      ipAddress: req.ip
    });

    res.json({
      ok: true,
      message: `تم فحص ${results.length} مصدر بنجاح`,
      results
    });
  } catch (err) {
    console.error('Error testing all sources:', err);
    res.status(500).json({ ok: false, error: 'حدث خطأ أثناء فحص المصادر' });
  }
});

/**
 * Test source connection
 */
router.post('/:id/test', async (req, res) => {
  const { id } = req.params;
  const sourceStmt = db.prepare('SELECT * FROM stream_sources WHERE id = ?');
  const source = sourceStmt.get(id);

  if (!source) {
    return res.status(404).json({ ok: false, error: 'المصدر غير موجود' });
  }

  const testResult = await runSourceConnectionTest(source);

  logAudit({
    adminId: req.admin.id,
    adminUsername: req.admin.username,
    action: 'TEST_SOURCE_CONNECTION',
    entityType: 'stream_source',
    entityId: id,
    details: { result: testResult.ok ? 'SUCCESS' : 'FAILED', message: testResult.error || 'Connected' },
    ipAddress: req.ip
  });

  res.json({
    ok: testResult.ok,
    error: testResult.error,
    info: testResult.info
  });
});

/**
 * Fetch channels from source and return preview diff before committing
 */
router.post('/:id/import-preview', m3uUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  const sourceStmt = db.prepare('SELECT * FROM stream_sources WHERE id = ?');
  const source = sourceStmt.get(id);

  if (!source) {
    return res.status(404).json({ ok: false, error: 'المصدر غير موجود' });
  }

  const creds = source.credentials_encrypted ? (decrypt(source.credentials_encrypted, true) || {}) : {};
  let fetchedChannels = [];

  try {
    if (source.type === 'xtream') {
      fetchedChannels = await fetchXtreamChannels(source.endpoint, creds.username, creds.password);
    } else if (source.type === 'stalker') {
      fetchedChannels = await fetchStalkerChannels(source.endpoint, creds);
    } else if (source.type === 'm3u') {
      let content = '';
      if (req.file) {
        content = req.file.buffer.toString('utf8');
      } else if (req.body?.m3uContent) {
        content = req.body.m3uContent;
      } else if (source.endpoint) {
        const fetchRes = await safeFetch(source.endpoint, { timeoutMs: 25000 });
        if (!fetchRes.ok) {
          throw new Error(`فشل تحميل ملف M3U من الرابط (${fetchRes.status})`);
        }
        content = await fetchRes.text();
      } else {
        throw new Error('لا يوجد رابط M3U أو ملف مرفوع للمعالجة');
      }

      const parsed = parseM3U(content);
      fetchedChannels = parsed.channels;
    }

    const diff = calculateSyncDiff(id, fetchedChannels);

    res.json({
      ok: true,
      diff,
      totalFetched: fetchedChannels.length
    });
  } catch (err) {
    console.error('Import preview error:', err);
    res.status(400).json({
      ok: false,
      error: `فشل جلب القنوات من المصدر: ${err.message}`
    });
  }
});

/**
 * Execute synchronization of channels
 */
router.post('/:id/sync', m3uUpload.single('file'), async (req, res) => {
  const { id } = req.params;
  const { autoActivate, handleSuspended, m3uContent } = req.body;

  const sourceStmt = db.prepare('SELECT * FROM stream_sources WHERE id = ?');
  const source = sourceStmt.get(id);

  if (!source) {
    return res.status(404).json({ ok: false, error: 'المصدر غير موجود' });
  }

  const creds = source.credentials_encrypted ? (decrypt(source.credentials_encrypted, true) || {}) : {};
  let fetchedChannels = [];

  try {
    if (source.type === 'xtream') {
      fetchedChannels = await fetchXtreamChannels(source.endpoint, creds.username, creds.password);
    } else if (source.type === 'stalker') {
      fetchedChannels = await fetchStalkerChannels(source.endpoint, creds);
    } else if (source.type === 'm3u') {
      let content = '';
      if (req.file) {
        content = req.file.buffer.toString('utf8');
      } else if (m3uContent) {
        content = m3uContent;
      } else if (source.endpoint) {
        const fetchRes = await safeFetch(source.endpoint, { timeoutMs: 25000 });
        if (!fetchRes.ok) throw new Error(`فشل تحميل قائمة M3U (${fetchRes.status})`);
        content = await fetchRes.text();
      } else {
        throw new Error('لا يوجد ملف أو رابط M3U متاح');
      }
      const parsed = parseM3U(content);
      fetchedChannels = parsed.channels;
    }

    const result = executeSync(id, fetchedChannels, {
      autoActivate: autoActivate === 'true' || autoActivate === true,
      handleSuspended: handleSuspended || 'keep'
    });

    logAudit({
      adminId: req.admin.id,
      adminUsername: req.admin.username,
      action: 'SYNC_SOURCE',
      entityType: 'stream_source',
      entityId: id,
      details: {
        sourceName: source.name,
        newCount: result.newCount,
        updatedCount: result.updatedCount,
        suspendedCount: result.suspendedCount,
        totalChannels: result.totalChannels
      },
      ipAddress: req.ip
    });

    res.json({
      ok: true,
      message: `تمت المزامنة بنجاح: تم إضافة ${result.newCount} قناة جديدة، وتحديث ${result.updatedCount} قناة.`,
      result
    });
  } catch (err) {
    console.error('Sync execution error:', err);
    res.status(500).json({ ok: false, error: `فشلت المزامنة: ${err.message}` });
  }
});

export default router;
