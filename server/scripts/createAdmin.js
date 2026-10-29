import readline from 'readline';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { logAudit } from '../services/auditService.js';

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('==================================================');
  console.log('   إنشاء مدير جديد لمنصة البث المباشر (IPTV Admin)');
  console.log('==================================================\n');

  let username = process.argv[2];
  let email = process.argv[3];
  let password = process.argv[4];

  if (!username) {
    username = await prompt('اسم المستخدم (Username): ');
  }
  if (!username || username.length < 3) {
    console.error('❌ خطأ: اسم المستخدم يجب أن يكون 3 أحرف على الأقل.');
    process.exit(1);
  }

  if (!email) {
    email = await prompt('البريد الإلكتروني (اختياري - اضغط Enter للتخطي): ');
  }

  if (!password) {
    password = await prompt('كلمة المرور (8 خانات على الأقل): ');
  }
  if (!password || password.length < 8) {
    console.error('❌ خطأ: كلمة المرور يجب أن تكون 8 خانات على الأقل.');
    process.exit(1);
  }

  const cleanUsername = username.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(cleanUsername);

  if (existing) {
    console.error(`❌ خطأ: اسم المستخدم "${cleanUsername}" مسجل بالفعل.`);
    process.exit(1);
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO admins (id, username, email, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', ?, ?)
    `).run(id, cleanUsername, email || null, passwordHash, now, now);

    logAudit({
      adminId: id,
      adminUsername: cleanUsername,
      action: 'CLI_CREATE_ADMIN',
      details: { username: cleanUsername, email: email || null },
      ipAddress: '127.0.0.1 (CLI)'
    });

    console.log(`\n✅ تم إنشاء حساب المدير بنجاح!`);
    console.log(`👤 اسم المستخدم: ${cleanUsername}`);
    console.log(`📧 البريد: ${email || 'غير محدد'}`);
    console.log(`\nيمكنك الآن تشغيل الخادم وتسجيل الدخول عبر المتصفح.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ فشل إنشاء الحساب:', err.message);
    process.exit(1);
  }
}

main();
