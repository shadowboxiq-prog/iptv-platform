import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createApp } from '../server/app.js';
import { db } from '../server/db/index.js';

describe('Auth & Viewer Isolation Integration Tests', () => {
  const app = createApp();
  let adminUsername = 'testadmin_' + Date.now();
  let adminPassword = 'StrongPassword99!';
  let adminToken = '';

  beforeAll(async () => {
    // Insert an admin for testing
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const id = uuidv4();
    const now = new Date().toISOString();
    const adminEmail = `testadmin_${Date.now()}@example.com`;
    db.prepare(`
      INSERT INTO admins (id, username, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', ?, ?)
    `).run(id, adminUsername, adminEmail, passwordHash, now, now);
  });

  it('should deny unauthenticated viewers from accessing admin sources route', async () => {
    const res = await request(app).get('/api/admin/sources');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('should deny unauthenticated viewers from accessing admin channels route', async () => {
    const res = await request(app).get('/api/admin/channels');
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminUsername, password: 'WrongPassword' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('should successfully log in with correct credentials and issue a session', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminUsername, password: adminPassword });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
    adminToken = res.body.token;

    // Cookie must be set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some(c => c.includes('admin_token'))).toBe(true);
  });

  it('should allow authenticated admin to access admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/sources')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.sources)).toBe(true);
  });

  it('should NEVER expose credentials, tokens, or raw upstream URLs in viewer channels response', async () => {
    const res = await request(app).get('/api/player/channels');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.channels)).toBe(true);

    for (const ch of res.body.channels) {
      expect(ch).not.toHaveProperty('playback_ref');
      expect(ch).not.toHaveProperty('backup_playback_ref');
      expect(ch).not.toHaveProperty('credentials');
      expect(ch).not.toHaveProperty('password');
      expect(ch).not.toHaveProperty('token');
      // Stream URL must point to our secure internal proxy route
      expect(ch.playbackUrl).toMatch(/^\/api\/player\/stream\//);
    }
  });

  it('should return public settings without exposing sensitive configuration', async () => {
    const res = await request(app).get('/api/player/settings');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.settings).toBeDefined();
    expect(res.body.settings.appTitle).toBeDefined();
    expect(res.body.settings).not.toHaveProperty('jwtSecret');
    expect(res.body.settings).not.toHaveProperty('appSecretKey');
  });

  it('should allow admin to fetch channel categories and deny unauthenticated viewer', async () => {
    const unauthRes = await request(app).get('/api/admin/channels/categories');
    expect(unauthRes.status).toBe(401);

    const authRes = await request(app)
      .get('/api/admin/channels/categories')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(authRes.status).toBe(200);
    expect(authRes.body.ok).toBe(true);
    expect(Array.isArray(authRes.body.categories)).toBe(true);
  });
});
