require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// تهيئة قاعدة البيانات
const db = new sqlite3.Database('./database.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// إنشاء الجداول
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'new',
      response TEXT,
      respondedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      playerPhone TEXT NOT NULL,
      playerName TEXT,
      fileUrl TEXT NOT NULL,
      uploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      answers TEXT NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      submittedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL
    )
  `);

  // إضافة المدير إذا لم يكن موجودًا
  const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 8);
  db.run(`
    INSERT OR IGNORE INTO admin (username, password) 
    VALUES (?, ?)
  `, [process.env.ADMIN_USERNAME || 'admin', adminPassword]);
});

// تكوين multer لرفع الملفات
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// تكوين إرسال البريد
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// تكوين الجلسات
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
  }
};

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(session(sessionConfig));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// تحقق من تسجيل دخول المدير
const isAdminAuthenticated = (req, res, next) => {
  if (req.session.adminLoggedIn) {
    return next();
  }
  return res.status(401).json({ loggedIn: false });
};

// Routes للواجهة الأمامية
app.post('/api/booking', async (req, res) => {
  try {
    const { bName, bEmail, bPhone } = req.body;
    const id = uuidv4();
    
    db.run(
      `INSERT INTO bookings (id, name, email, phone) 
       VALUES (?, ?, ?, ?)`,
      [id, bName, bEmail, bPhone],
      function(err) {
        if (err) {
          console.error('Error saving booking:', err);
          return res.status(500).json({ success: false, message: 'حدث خطأ أثناء تقديم الطلب' });
        }
        res.json({ success: true, message: 'تم تقديم طلب الانضمام بنجاح', bookingId: id });
      }
    );
  } catch (error) {
    console.error('Error in booking:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تقديم الطلب' });
  }
});

app.get('/api/results/:phone', (req, res) => {
  const phone = req.params.phone;
  
  db.all(
    `SELECT * FROM results WHERE playerPhone = ?`,
    [phone],
    (err, results) => {
      if (err) {
        console.error('Error fetching results:', err);
        return res.status(500).json({ success: false, message: 'حدث خطأ أثناء جلب النتائج' });
      }
      
      if (results.length > 0) {
        res.json({ success: true, results });
      } else {
        res.json({ success: false, message: 'لا توجد نتائج لهذا الرقم' });
      }
    }
  );
});

// API للاستفسارات
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    const id = uuidv4();

    db.run(
      `INSERT INTO inquiries (id, name, email, phone, message) 
       VALUES (?, ?, ?, ?, ?)`,
      [id, name, email, phone, message],
      function(err) {
        if (err) {
          console.error('Error saving inquiry:', err);
          return res.status(500).json({ 
            success: false, 
            message: 'حدث خطأ أثناء إرسال الاستفسار' 
          });
        }
        res.json({ 
          success: true, 
          message: 'تم إرسال استفسارك بنجاح' 
        });
      }
    );
  } catch (error) {
    console.error('Error in contact form:', error);
    res.status(500).json({ 
      success: false, 
      message: 'حدث خطأ أثناء إرسال الاستفسار' 
    });
  }
});

// API لتسجيل نتائج الاختبار
app.post('/api/submit-quiz', async (req, res) => {
  try {
    const { name, phone, email, answers } = req.body;
    
    // حساب النتيجة
    const correctAnswers = {
      q1: "b", // القاهرة
      q2: "b", // 366
      q3: "b", // الأكسجين
      q4: "c", // يوسف زيدان
      q5: "c"  // الين
    };
    
    let score = 0;
    const total = 25; // مجموع النقاط
    
    for (const [question, answer] of Object.entries(answers)) {
      if (answer === correctAnswers[question]) {
        score += 5;
      }
    }
    
    const id = uuidv4();
    
    db.run(
      `INSERT INTO quizzes (id, name, phone, email, answers, score, total) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, phone, email, JSON.stringify(answers), score, total],
      function(err) {
        if (err) {
          console.error('Error saving quiz result:', err);
          return res.status(500).json({ success: false, message: 'حدث خطأ أثناء حفظ النتيجة' });
        }
        res.json({ 
          success: true, 
          message: 'تم تسجيل النتيجة بنجاح',
          score,
          total
        });
      }
    );
  } catch (error) {
    console.error('Error in quiz submission:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تسجيل النتيجة' });
  }
});

// Routes لوحة التحكم
app.get('/admin/dashboard', isAdminAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

app.get('/admin/data', isAdminAuthenticated, (req, res) => {
  db.serialize(() => {
    db.all(`SELECT * FROM bookings ORDER BY createdAt DESC`, [], (err, bookings) => {
      if (err) {
        console.error('Error fetching bookings:', err);
        return res.status(500).json({ success: false });
      }

      db.all(`SELECT * FROM inquiries ORDER BY createdAt DESC`, [], (err, inquiries) => {
        if (err) {
          console.error('Error fetching inquiries:', err);
          return res.status(500).json({ success: false });
        }

        db.all(`SELECT * FROM results ORDER BY uploadedAt DESC`, [], (err, results) => {
          if (err) {
            console.error('Error fetching results:', err);
            return res.status(500).json({ success: false });
          }

          db.all(`SELECT * FROM quizzes ORDER BY submittedAt DESC`, [], (err, quizzes) => {
            if (err) {
              console.error('Error fetching quizzes:', err);
              return res.status(500).json({ success: false });
            }

            res.json({
              bookings: bookings,
              inquiries: inquiries,
              results: results,
              quizzes: quizzes
            });
          });
        });
      });
    });
  });
});

app.get('/admin/quiz-results', isAdminAuthenticated, (req, res) => {
  db.all(
    `SELECT * FROM quizzes ORDER BY submittedAt DESC`,
    [],
    (err, results) => {
      if (err) {
        console.error('Error fetching quiz results:', err);
        return res.status(500).json({ success: false });
      }
      res.json({ success: true, results });
    }
  );
});

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    db.get(
      `SELECT * FROM admin WHERE username = ?`,
      [username],
      (err, admin) => {
        if (err || !admin) {
          return res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        if (bcrypt.compareSync(password, admin.password)) {
          req.session.adminLoggedIn = true;
          res.json({ success: true });
        } else {
          res.json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

app.get('/admin/check-session', (req, res) => {
  res.json({ loggedIn: !!req.session.adminLoggedIn });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

app.post('/admin/update-booking/:id', isAdminAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, notes } = req.body;

    db.run(
      `UPDATE bookings SET status = ?, notes = ? WHERE id = ?`,
      [status, notes, id],
      function(err) {
        if (err) {
          console.error('Error updating booking:', err);
          return res.json({ success: false, message: 'الطلب غير موجود' });
        }
        res.json({ success: true });
      }
    );
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تحديث الطلب' });
  }
});

app.delete('/admin/delete-booking/:id', isAdminAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    
    db.run(
      `DELETE FROM bookings WHERE id = ?`,
      [id],
      function(err) {
        if (err) {
          console.error('Error deleting booking:', err);
          return res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الطلب' });
        }
        res.json({ success: true, message: 'تم حذف الطلب بنجاح' });
      }
    );
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الطلب' });
  }
});

app.post('/admin/update-inquiry/:id', isAdminAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, response } = req.body;

    db.run(
      `UPDATE inquiries SET status = ?, response = ?, respondedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, response, id],
      function(err) {
        if (err) {
          console.error('Error updating inquiry:', err);
          return res.json({ success: false, message: 'الاستفسار غير موجود' });
        }
        res.json({ success: true });
      }
    );
  } catch (error) {
    console.error('Error updating inquiry:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء تحديث الاستفسار' });
  }
});

app.delete('/admin/delete-inquiry/:id', isAdminAuthenticated, async (req, res) => {
  try {
    const id = req.params.id;
    
    db.run(
      `DELETE FROM inquiries WHERE id = ?`,
      [id],
      function(err) {
        if (err) {
          console.error('Error deleting inquiry:', err);
          return res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الاستفسار' });
        }
        res.json({ success: true, message: 'تم حذف الاستفسار بنجاح' });
      }
    );
  } catch (error) {
    console.error('Error deleting inquiry:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الاستفسار' });
  }
});

app.post('/admin/send-message', isAdminAuthenticated, async (req, res) => {
  try {
    const { email, message, senderName = "Clan King个ESPORTSツ" } = req.body;

    transporter.sendMail({
      from: `"${senderName}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'رسالة من كلان  King个ESPORTSツ',
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4f46e5;">رسالة من Clan King个ESPORTSツ</h2>
          <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin-top: 20px;">
            ${message.replace(/\n/g, '<br>')}
          </div>
          <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
            هذه الرسالة مرسلة من نظام Clan King个ESPORTSツ - لا ترد على هذا البريد
          </p>
        </div>
      `
    }).catch(err => console.error('Email sending error:', err));

    res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, message: 'فشل إرسال الرسالة' });
  }
});

app.post('/admin/upload-result', isAdminAuthenticated, upload.single('resultFile'), async (req, res) => {
  try {
    const { playerPhone, playerName } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'لم يتم اختيار ملف' });
    }

    const fileUrl = '/uploads/' + req.file.filename;

    db.run(
      `INSERT INTO results (id, playerPhone, playerName, fileUrl) 
       VALUES (?, ?, ?, ?)`,
      [uuidv4(), playerPhone, playerName, fileUrl],
      function(err) {
        if (err) {
          console.error('Error uploading result:', err);
          return res.status(500).json({ success: false, message: 'حدث خطأ أثناء رفع الملف' });
        }

        res.json({ 
          success: true, 
          message: 'تم رفع النتيجة بنجاح',
          fileUrl: fileUrl
        });
      }
    );
  } catch (error) {
    console.error('Error uploading result:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء رفع الملف' });
  }
});

app.delete('/admin/delete-result/:id', isAdminAuthenticated, async (req, res) => {
  try {
    const resultId = req.params.id;
    
    db.get(
      `SELECT fileUrl FROM results WHERE id = ?`,
      [resultId],
      (err, result) => {
        if (err || !result) {
          return res.status(404).json({ success: false, message: 'النتيجة غير موجودة' });
        }

        const filePath = path.join(__dirname, 'public', result.fileUrl);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        db.run(
          `DELETE FROM results WHERE id = ?`,
          [resultId],
          function(err) {
            if (err) {
              console.error('Error deleting result:', err);
              return res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف النتيجة' });
            }
            res.json({ success: true, message: 'تم حذف النتيجة بنجاح' });
          }
        );
      }
    );
  } catch (error) {
    console.error('Error deleting result:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف النتيجة' });
  }
});

// Routes للملفات الثابتة
app.get('/admin-login.html', (req, res) => {
  if (req.session.adminLoggedIn) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error('Server error:', err);
});