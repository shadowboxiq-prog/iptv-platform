import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { redactSensitiveData } from './cryptoService.js';

/**
 * Record an action in the audit logs table with stripped secrets.
 * 
 * @param {object} params
 * @param {string} [params.adminId]
 * @param {string} [params.adminUsername]
 * @param {string} params.action
 * @param {string} [params.entityType]
 * @param {string} [params.entityId]
 * @param {object|string} [params.details]
 * @param {string} [params.ipAddress]
 */
export function logAudit({
  adminId = null,
  adminUsername = 'مجهول/النظام',
  action,
  entityType = null,
  entityId = null,
  details = null,
  ipAddress = null
}) {
  try {
    let cleanDetails = null;
    if (details) {
      if (typeof details === 'object') {
        cleanDetails = JSON.stringify(redactSensitiveData(details));
      } else {
        cleanDetails = String(details);
      }
    }

    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, admin_id, admin_username, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      uuidv4(),
      adminId,
      adminUsername,
      action,
      entityType,
      entityId,
      cleanDetails,
      ipAddress,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

/**
 * Get recent audit logs with pagination
 */
export function getAuditLogs(limit = 100, offset = 0) {
  const stmt = db.prepare(`
    SELECT * FROM audit_logs 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset);
}
