const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'library.db');
const db = new Database(dbPath);

// Enable foreign keys and WAL mode for high performance
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn_or_code TEXT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category TEXT NOT NULL,
      edition TEXT,
      shelf_location TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS book_copies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      copy_code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('AVAILABLE', 'ISSUED', 'DAMAGED', 'LOST', 'MAINTENANCE')) DEFAULT 'AVAILABLE',
      condition_note TEXT DEFAULT 'Good condition',
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT DEFAULT 'Student',
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'SUSPENDED')) DEFAULT 'ACTIVE',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      copy_id INTEGER NOT NULL,
      member_id INTEGER NOT NULL,
      issue_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      due_date DATETIME NOT NULL,
      return_date DATETIME,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'RETURNED')) DEFAULT 'ACTIVE',
      return_condition TEXT,
      fine REAL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (copy_id) REFERENCES book_copies (id) ON DELETE RESTRICT,
      FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_copies_book ON book_copies(book_id);
    CREATE INDEX IF NOT EXISTS idx_copies_code ON book_copies(copy_code);
    CREATE INDEX IF NOT EXISTS idx_members_code ON members(member_code);
    CREATE INDEX IF NOT EXISTS idx_trans_copy ON transactions(copy_id);
    CREATE INDEX IF NOT EXISTS idx_trans_member ON transactions(member_id);
    CREATE INDEX IF NOT EXISTS idx_trans_status ON transactions(status);
  `);

  // Seed sample data if database is empty
  const bookCount = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
  if (bookCount === 0) {
    seedDatabase();
  }
}

function seedDatabase() {
  console.log('Seeding initial library dataset with realistic books, copies, and history...');

  const insertBook = db.prepare(`
    INSERT INTO books (isbn_or_code, title, author, category, edition, shelf_location, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCopy = db.prepare(`
    INSERT INTO book_copies (book_id, copy_code, status, condition_note, added_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMember = db.prepare(`
    INSERT INTO members (member_code, name, email, phone, role, status, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTx = db.prepare(`
    INSERT INTO transactions (copy_id, member_id, issue_date, due_date, return_date, status, return_condition, fine, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    // 1. Members
    const m1 = insertMember.run('MEM-101', 'Aarav Sharma', 'aarav.sharma@school.edu', '9876543210', 'Student', 'ACTIVE', '2026-08-01 10:00:00').lastInsertRowid;
    const m2 = insertMember.run('MEM-102', 'Priya Verma', 'priya.verma@school.edu', '9812345678', 'Student', 'ACTIVE', '2026-08-05 11:30:00').lastInsertRowid;
    const m3 = insertMember.run('MEM-103', 'Rohan Gupta', 'rohan.gupta@school.edu', '9898989898', 'Faculty', 'ACTIVE', '2026-07-15 09:15:00').lastInsertRowid;
    const m4 = insertMember.run('MEM-104', 'Ananya Singh', 'ananya.singh@school.edu', '9765432109', 'Student', 'ACTIVE', '2026-08-20 14:00:00').lastInsertRowid;
    const m5 = insertMember.run('MEM-105', 'Vikram Malhotra', 'vikram.m@school.edu', '9654321098', 'Student', 'ACTIVE', '2026-09-01 12:45:00').lastInsertRowid;

    // 2. Books & Copies
    // Book 1: RS Aggarwal Mathematics - Class 10 (10 copies: RS10-001 to RS10-010)
    const b1 = insertBook.run(
      '978-8177098488',
      'RS Aggarwal Mathematics - Class 10',
      'R.S. Aggarwal',
      'Mathematics',
      '2025 Revised Edition',
      'Shelf A-1',
      'Comprehensive textbook for CBSE Class 10 Board exam preparation.'
    ).lastInsertRowid;

    const b1Copies = [];
    for (let i = 1; i <= 10; i++) {
      const code = `RS10-${String(i).padStart(3, '0')}`;
      const copyId = insertCopy.run(b1, code, 'AVAILABLE', 'Good condition', '2026-08-10 10:00:00').lastInsertRowid;
      b1Copies.push({ id: copyId, code });
    }

    // Book 2: RD Sharma Mathematics - Class 10 (5 copies)
    const b2 = insertBook.run(
      '978-9383182817',
      'Mathematics for Class 10 - R.D. Sharma',
      'R.D. Sharma',
      'Mathematics',
      'Latest Edition',
      'Shelf A-2',
      'In-depth practice problems and theoretical proofs.'
    ).lastInsertRowid;

    const b2Copies = [];
    for (let i = 1; i <= 5; i++) {
      const code = `RD10-${String(i).padStart(3, '0')}`;
      const copyId = insertCopy.run(b2, code, 'AVAILABLE', 'Good condition', '2026-08-10 10:00:00').lastInsertRowid;
      b2Copies.push({ id: copyId, code });
    }

    // Book 3: Concepts of Physics (Vol 1) - H.C. Verma (6 copies)
    const b3 = insertBook.run(
      '978-8177091878',
      'Concepts of Physics - Volume 1',
      'H.C. Verma',
      'Physics',
      '2024 Edition',
      'Shelf B-1',
      'Foundational physics textbook for high school and competitive engineering exams.'
    ).lastInsertRowid;

    const b3Copies = [];
    for (let i = 1; i <= 6; i++) {
      const code = `HCV1-${String(i).padStart(3, '0')}`;
      const copyId = insertCopy.run(b3, code, 'AVAILABLE', 'Good condition', '2026-08-12 11:00:00').lastInsertRowid;
      b3Copies.push({ id: copyId, code });
    }

    // Book 4: NCERT Science - Class 10 (8 copies)
    const b4 = insertBook.run(
      '978-8174506344',
      'Science Textbook for Class 10 - NCERT',
      'NCERT Editorial Board',
      'Science',
      'Reprint 2025',
      'Shelf B-2',
      'Official NCERT textbook covering Physics, Chemistry, and Biology.'
    ).lastInsertRowid;

    const b4Copies = [];
    for (let i = 1; i <= 8; i++) {
      const code = `NCRT10-${String(i).padStart(3, '0')}`;
      const copyId = insertCopy.run(b4, code, 'AVAILABLE', 'Good condition', '2026-08-15 09:30:00').lastInsertRowid;
      b4Copies.push({ id: copyId, code });
    }

    // Book 5: Clean Code (3 copies)
    const b5 = insertBook.run(
      '978-0132350884',
      'Clean Code: A Handbook of Agile Software Craftsmanship',
      'Robert C. Martin',
      'Computer Science',
      '1st Edition',
      'Shelf C-1',
      'Software engineering best practices, patterns, and refactoring guidelines.'
    ).lastInsertRowid;

    const b5Copies = [];
    for (let i = 1; i <= 3; i++) {
      const code = `CC-${String(i).padStart(3, '0')}`;
      const copyId = insertCopy.run(b5, code, 'AVAILABLE', 'Good condition', '2026-08-20 12:00:00').lastInsertRowid;
      b5Copies.push({ id: copyId, code });
    }

    // 3. Transactions & Audit Trail Simulation
    // Specifically demonstrate copy RS10-008 history requested by user:
    // Past checkout 1: Rohan Gupta (MEM-103) borrowed & returned clean
    const copy8 = b1Copies[7]; // RS10-008
    insertTx.run(
      copy8.id,
      m3,
      '2026-09-01 10:15:00',
      '2026-09-15 17:00:00',
      '2026-09-12 14:20:00',
      'RETURNED',
      'Returned intact in pristine condition',
      0,
      'Standard faculty loan'
    );

    // Past checkout 2: Aarav Sharma (MEM-101) borrowed & returned with damage note!
    insertTx.run(
      copy8.id,
      m1,
      '2026-09-15 15:30:00',
      '2026-09-29 17:00:00',
      '2026-09-25 16:10:00',
      'RETURNED',
      'Page 42 bottom-corner torn. Minor pencil scribbles.',
      15.0,
      'Damaged copy reported during return inspection'
    );

    // Active checkout on RS10-008: Currently with Ananya Singh (MEM-104)!
    insertTx.run(
      copy8.id,
      m4,
      '2026-10-10 11:00:00',
      '2026-10-24 17:00:00',
      null,
      'ACTIVE',
      null,
      0,
      'Board exam preparation loan'
    );
    db.prepare("UPDATE book_copies SET status = 'ISSUED', condition_note = 'Page 42 corner torn' WHERE id = ?").run(copy8.id);

    // Another active checkout: RS10-002 to Priya Verma
    const copy2 = b1Copies[1];
    insertTx.run(
      copy2.id,
      m2,
      '2026-10-05 10:00:00',
      '2026-10-19 17:00:00', // Overdue!
      null,
      'ACTIVE',
      null,
      0,
      'Math unit test practice'
    );
    db.prepare("UPDATE book_copies SET status = 'ISSUED' WHERE id = ?").run(copy2.id);

    // Active checkout: HCV1-001 to Vikram Malhotra
    const hcvCopy1 = b3Copies[0];
    insertTx.run(
      hcvCopy1.id,
      m5,
      '2026-10-12 14:00:00',
      '2026-10-26 17:00:00',
      null,
      'ACTIVE',
      null,
      0,
      'Physics mechanics study'
    );
    db.prepare("UPDATE book_copies SET status = 'ISSUED' WHERE id = ?").run(hcvCopy1.id);

    // Active checkout: CC-001 to Rohan Gupta
    const ccCopy1 = b5Copies[0];
    insertTx.run(
      ccCopy1.id,
      m3,
      '2026-10-14 09:30:00',
      '2026-10-28 17:00:00',
      null,
      'ACTIVE',
      null,
      0,
      'Curriculum research'
    );
    db.prepare("UPDATE book_copies SET status = 'ISSUED' WHERE id = ?").run(ccCopy1.id);
  });

  transaction();
  console.log('Seeding complete! Database initialized with rich operational records.');
}

module.exports = {
  db,
  initializeDatabase
};
