import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/authRoutes.js';
import viewerRoutes from './routes/viewerRoutes.js';
import sourceRoutes from './routes/sourceRoutes.js';
import channelRoutes from './routes/channelRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // Basic security and parsing middleware
  const allowedOrigins = new Set(
    String(process.env.APP_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/player', viewerRoutes);
  app.use('/api/admin/sources', sourceRoutes);
  app.use('/api/admin/channels', channelRoutes);
  app.use('/api/admin', adminRoutes);

  // Serve static assets from frontend build in production
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));

  // SPA fallback for HTML5 history API (excluding /api routes)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'), (err) => {
      if (err) {
        // If dist hasn't been built yet in dev mode
        res.status(200).send(`
          <!DOCTYPE html>
          <html lang="ar" dir="rtl">
          <head><meta charset="UTF-8"><title>منصة البث المباشر</title></head>
          <body style="font-family:sans-serif;text-align:center;padding:50px;">
            <h2>خادم المنصة قيد العمل</h2>
            <p>لتشغيل واجهة المستخدم أثناء التطوير، شغل أمر <code>npm run dev</code> أو <code>npm run build</code>.</p>
          </body>
          </html>
        `);
      }
    });
  });

  // Global Error Handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'حدث خطأ غير متوقع في الخادم'
    });
  });

  return app;
}

export default createApp;
