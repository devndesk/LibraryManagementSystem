const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { db, initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database
initializeDatabase();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. DASHBOARD & ANALYTICS STATS API
// ==========================================
app.get('/api/stats', (req, res) => {
  try {
    const totalTitles = db.prepare('SELECT COUNT(*) as c FROM books').get().c;
    const totalCopies = db.prepare('SELECT COUNT(*) as c FROM book_copies').get().c;
    const availableCopies = db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'AVAILABLE'").get().c;
    const issuedCopies = db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status = 'ISSUED'").get().c;
    const damagedCopies = db.prepare("SELECT COUNT(*) as c FROM book_copies WHERE status IN ('DAMAGED', 'LOST', 'MAINTENANCE')").get().c;
    const totalMembers = db.prepare('SELECT COUNT(*) as c FROM members').get().c;

    const overdueCount = db.prepare(`
      SELECT COUNT(*) as c FROM transactions 
      WHERE status = 'ACTIVE' AND datetime(due_date) < datetime('now', 'localtime')
    `).get().c;

    const recentActivity = db.prepare(`
      SELECT t.id, t.status, t.issue_date, t.return_date, t.due_date,
             c.copy_code, b.title as book_title, m.name as member_name, m.member_code
      FROM transactions t
      JOIN book_copies c ON t.copy_id = c.id
      JOIN books b ON c.book_id = b.id
      JOIN members m ON t.member_id = m.id
      ORDER BY t.id DESC LIMIT 8
    `).all();

    res.json({
      totalTitles,
      totalCopies,
      availableCopies,
      issuedCopies,
      damagedCopies,
      overdueCount,
      totalMembers,
      recentActivity
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. BOOKS & COPIES APIs (CRUD & Stock)
// ==========================================

// Get all books with stock statistics
app.get('/api/books', (req, res) => {
  try {
    const { q, category, status } = req.query;

    let query = `
      SELECT b.*,
        COUNT(c.id) as total_copies,
        SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END) as available_copies,
        SUM(CASE WHEN c.status = 'ISSUED' THEN 1 ELSE 0 END) as issued_copies,
        SUM(CASE WHEN c.status IN ('DAMAGED', 'LOST', 'MAINTENANCE') THEN 1 ELSE 0 END) as damaged_copies
      FROM books b
      LEFT JOIN book_copies c ON b.id = c.book_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      query += ` AND (b.title LIKE ? OR b.author LIKE ? OR b.isbn_or_code LIKE ? OR b.category LIKE ?)`;
      const term = `%${q}%`;
      params.push(term, term, term, term);
    }

    if (category && category !== 'ALL') {
      query += ` AND b.category = ?`;
      params.push(category);
    }

    query += ` GROUP BY b.id ORDER BY b.id DESC`;

    let books = db.prepare(query).all(...params);

    // Apply stock status filter if provided
    if (status) {
      if (status === 'IN_STOCK') {
        books = books.filter(b => b.available_copies > 0);
      } else if (status === 'OUT_OF_STOCK') {
        books = books.filter(b => b.available_copies === 0);
      }
    }

    res.json(books);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get categories list
app.get('/api/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT category FROM books ORDER BY category ASC').all();
    res.json(rows.map(r => r.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single book with all its individual physical copies
app.get('/api/books/:id', (req, res) => {
  try {
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const copies = db.prepare(`
      SELECT c.*,
             m.name as current_borrower_name,
             m.member_code as current_borrower_code,
             t.issue_date,
             t.due_date,
             t.id as active_transaction_id
      FROM book_copies c
      LEFT JOIN transactions t ON t.copy_id = c.id AND t.status = 'ACTIVE'
      LEFT JOIN members m ON t.member_id = m.id
      WHERE c.book_id = ?
      ORDER BY c.copy_code ASC
    `).all(req.params.id);

    res.json({ ...book, copies });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new Book and generate batch copies
app.post('/api/books', (req, res) => {
  try {
    const { title, author, category, isbn_or_code, edition, shelf_location, description, copy_count, copy_prefix } = req.body;

    if (!title || !author) {
      return res.status(400).json({ error: 'Title and Author are required' });
    }

    const numCopies = Math.max(1, parseInt(copy_count, 10) || 1);
    const prefix = (copy_prefix || title.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BK').trim();

    const insertBook = db.prepare(`
      INSERT INTO books (isbn_or_code, title, author, category, edition, shelf_location, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertCopy = db.prepare(`
      INSERT INTO book_copies (book_id, copy_code, status, condition_note)
      VALUES (?, ?, 'AVAILABLE', 'Good condition')
    `);

    const transaction = db.transaction(() => {
      const bookResult = insertBook.run(
        isbn_or_code || '',
        title.trim(),
        author.trim(),
        category || 'General',
        edition || '',
        shelf_location || '',
        description || ''
      );

      const bookId = bookResult.lastInsertRowid;
      const createdCopies = [];

      for (let i = 1; i <= numCopies; i++) {
        const copyCode = `${prefix}-${String(i).padStart(3, '0')}`;
        insertCopy.run(bookId, copyCode);
        createdCopies.push(copyCode);
      }

      return { bookId, createdCopies };
    });

    const result = transaction();
    res.status(201).json({
      message: `Book "${title}" created with ${result.createdCopies.length} physical copies`,
      bookId: result.bookId,
      copies: result.createdCopies
    });
  } catch (error) {
    console.error('Book creation error:', error);
    if (error.message.includes('UNIQUE constraint failed: book_copies.copy_code')) {
      return res.status(400).json({ error: 'A copy with this prefix/code already exists. Please choose a distinct copy prefix.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Update Book Master details
app.put('/api/books/:id', (req, res) => {
  try {
    const { title, author, category, isbn_or_code, edition, shelf_location, description } = req.body;
    const stmt = db.prepare(`
      UPDATE books 
      SET title = ?, author = ?, category = ?, isbn_or_code = ?, edition = ?, shelf_location = ?, description = ?
      WHERE id = ?
    `);
    const info = stmt.run(title, author, category, isbn_or_code, edition, shelf_location, description, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Book not found' });
    res.json({ message: 'Book updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Book (blocks if any copy is currently issued)
app.delete('/api/books/:id', (req, res) => {
  try {
    const issuedCopies = db.prepare(`
      SELECT COUNT(*) as c FROM book_copies WHERE book_id = ? AND status = 'ISSUED'
    `).get(req.params.id).c;

    if (issuedCopies > 0) {
      return res.status(400).json({ error: `Cannot delete book. ${issuedCopies} copy(ies) are currently issued to members.` });
    }

    const txCount = db.prepare(`
      SELECT COUNT(*) as c FROM transactions t
      JOIN book_copies c ON t.copy_id = c.id
      WHERE c.book_id = ?
    `).get(req.params.id).c;

    if (txCount > 0) {
      // Archive or delete historical transactions if desired
      db.prepare(`
        DELETE FROM transactions WHERE copy_id IN (SELECT id FROM book_copies WHERE book_id = ?)
      `).run(req.params.id);
    }

    db.prepare('DELETE FROM book_copies WHERE book_id = ?').run(req.params.id);
    db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);

    res.json({ message: 'Book and its copies deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add extra copies to existing book
app.post('/api/books/:id/copies', (req, res) => {
  try {
    const bookId = req.params.id;
    const { count, prefix } = req.body;
    const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const numCopies = Math.max(1, parseInt(count, 10) || 1);
    const existingCount = db.prepare('SELECT COUNT(*) as c FROM book_copies WHERE book_id = ?').get(bookId).c;
    const codePrefix = (prefix || 'CPY').trim();

    const insertCopy = db.prepare(`
      INSERT INTO book_copies (book_id, copy_code, status, condition_note)
      VALUES (?, ?, 'AVAILABLE', 'Good condition')
    `);

    const added = [];
    const tx = db.transaction(() => {
      for (let i = 1; i <= numCopies; i++) {
        const nextNum = existingCount + i;
        const copyCode = `${codePrefix}-${String(nextNum).padStart(3, '0')}`;
        insertCopy.run(bookId, copyCode);
        added.push(copyCode);
      }
    });

    tx();
    res.status(201).json({ message: `Added ${added.length} new copies`, added });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update specific copy status / condition note
app.put('/api/copies/:id', (req, res) => {
  try {
    const { status, condition_note } = req.body;
    const stmt = db.prepare(`
      UPDATE book_copies 
      SET status = COALESCE(?, status), condition_note = COALESCE(?, condition_note)
      WHERE id = ?
    `);
    const info = stmt.run(status, condition_note, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Copy not found' });
    res.json({ message: 'Copy updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search copies by code
app.get('/api/copies/search', (req, res) => {
  try {
    const { q, available_only } = req.query;
    let query = `
      SELECT c.*, b.title as book_title, b.author as book_author, b.category
      FROM book_copies c
      JOIN books b ON c.book_id = b.id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      query += ` AND (c.copy_code LIKE ? OR b.title LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }

    if (available_only === 'true') {
      query += ` AND c.status = 'AVAILABLE'`;
    }

    query += ` ORDER BY c.copy_code ASC LIMIT 25`;
    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. COPY AUDIT & INSPECTOR (DAMAGE TRACKER)
// ==========================================
// Crucial requirement: Find out who had this copy last, who damaged it, full timeline!
app.get('/api/transactions/copy-history/:copyCode', (req, res) => {
  try {
    const copyCode = req.params.copyCode.trim();

    const copy = db.prepare(`
      SELECT c.*, b.title as book_title, b.author as book_author, b.category, b.edition, b.shelf_location
      FROM book_copies c
      JOIN books b ON c.book_id = b.id
      WHERE c.copy_code = ? COLLATE NOCASE
    `).get(copyCode);

    if (!copy) {
      return res.status(404).json({ error: `No physical copy found with Code: "${copyCode}"` });
    }

    // Current active checkout (if any)
    const activeCheckout = db.prepare(`
      SELECT t.*, m.name as member_name, m.member_code, m.email, m.phone, m.role
      FROM transactions t
      JOIN members m ON t.member_id = m.id
      WHERE t.copy_id = ? AND t.status = 'ACTIVE'
    `).get(copy.id);

    // Full history of all checkouts on this copy (ordered newest first)
    const history = db.prepare(`
      SELECT t.*, m.name as member_name, m.member_code, m.email, m.phone, m.role
      FROM transactions t
      JOIN members m ON t.member_id = m.id
      WHERE t.copy_id = ?
      ORDER BY t.id DESC
    `).all(copy.id);

    // Last borrower who returned this book
    const lastReturnedTx = db.prepare(`
      SELECT t.*, m.name as member_name, m.member_code, m.email, m.phone, m.role
      FROM transactions t
      JOIN members m ON t.member_id = m.id
      WHERE t.copy_id = ? AND t.status = 'RETURNED'
      ORDER BY t.return_date DESC LIMIT 1
    `).get(copy.id);

    res.json({
      copy,
      activeCheckout: activeCheckout || null,
      lastBorrower: lastReturnedTx || null,
      totalBorrowCount: history.length,
      history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. MEMBERS MANAGEMENT APIs
// ==========================================
app.get('/api/members', (req, res) => {
  try {
    const { q } = req.query;
    let query = `
      SELECT m.*,
        COUNT(CASE WHEN t.status = 'ACTIVE' THEN 1 END) as active_loans_count,
        COUNT(t.id) as total_borrowed_count
      FROM members m
      LEFT JOIN transactions t ON m.id = t.member_id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      query += ` AND (m.name LIKE ? OR m.member_code LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    query += ` GROUP BY m.id ORDER BY m.name ASC`;
    const members = db.prepare(query).all(...params);
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/members', (req, res) => {
  try {
    const { member_code, name, email, phone, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Member name is required' });

    let code = member_code ? member_code.trim() : '';
    if (!code) {
      const count = db.prepare('SELECT COUNT(*) as c FROM members').get().c;
      code = `MEM-${101 + count}`;
    }

    const stmt = db.prepare(`
      INSERT INTO members (member_code, name, email, phone, role, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `);
    const info = stmt.run(code, name.trim(), email || '', phone || '', role || 'Student');

    res.status(201).json({
      message: 'Member registered successfully',
      memberId: info.lastInsertRowid,
      member_code: code
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed: members.member_code')) {
      return res.status(400).json({ error: 'Member code already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/members/:id', (req, res) => {
  try {
    const { name, email, phone, role, status } = req.body;
    const stmt = db.prepare(`
      UPDATE members 
      SET name = COALESCE(?, name),
          email = COALESCE(?, email),
          phone = COALESCE(?, phone),
          role = COALESCE(?, role),
          status = COALESCE(?, status)
      WHERE id = ?
    `);
    const info = stmt.run(name, email, phone, role, status, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Member not found' });
    res.json({ message: 'Member updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/members/:id', (req, res) => {
  try {
    const activeLoans = db.prepare(`
      SELECT COUNT(*) as c FROM transactions WHERE member_id = ? AND status = 'ACTIVE'
    `).get(req.params.id).c;

    if (activeLoans > 0) {
      return res.status(400).json({ error: `Cannot delete member. Member currently holds ${activeLoans} unreturned book(s).` });
    }

    db.prepare('DELETE FROM transactions WHERE member_id = ?').run(req.params.id);
    db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
    res.json({ message: 'Member deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Member loan history
app.get('/api/members/:id/history', (req, res) => {
  try {
    const history = db.prepare(`
      SELECT t.*, c.copy_code, b.title as book_title, b.author as book_author
      FROM transactions t
      JOIN book_copies c ON t.copy_id = c.id
      JOIN books b ON c.book_id = b.id
      WHERE t.member_id = ?
      ORDER BY t.id DESC
    `).all(req.params.id);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. TRANSACTIONS (CIRCULATION) APIs
// ==========================================

// Issue a Book Copy to a Member
app.post('/api/transactions/issue', (req, res) => {
  try {
    const { copy_code, member_code, due_days = 14, notes = '' } = req.body;

    if (!copy_code || !member_code) {
      return res.status(400).json({ error: 'Copy Code and Member Code are required' });
    }

    // 1. Find Copy
    const copy = db.prepare(`
      SELECT c.*, b.title as book_title
      FROM book_copies c
      JOIN books b ON c.book_id = b.id
      WHERE c.copy_code = ? COLLATE NOCASE
    `).get(copy_code.trim());

    if (!copy) {
      return res.status(404).json({ error: `Physical Copy "${copy_code}" not found in catalog` });
    }

    if (copy.status !== 'AVAILABLE') {
      return res.status(400).json({
        error: `Copy "${copy.copy_code}" is currently ${copy.status}. Only AVAILABLE copies can be issued.`
      });
    }

    // 2. Find Member
    const member = db.prepare(`
      SELECT * FROM members WHERE member_code = ? COLLATE NOCASE OR id = ?
    `).get(member_code.trim(), member_code.trim());

    if (!member) {
      return res.status(404).json({ error: `Member "${member_code}" not found` });
    }

    if (member.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Member account is ${member.status}. Cannot issue books.` });
    }

    // Calculate due date
    const days = Math.max(1, parseInt(due_days, 10) || 14);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);
    const formattedDueDate = dueDate.toISOString().replace('T', ' ').substring(0, 19);

    const tx = db.transaction(() => {
      // Create transaction
      const stmt = db.prepare(`
        INSERT INTO transactions (copy_id, member_id, issue_date, due_date, status, notes)
        VALUES (?, ?, datetime('now', 'localtime'), ?, 'ACTIVE', ?)
      `);
      const info = stmt.run(copy.id, member.id, formattedDueDate, notes || 'Regular loan');

      // Update copy status
      db.prepare("UPDATE book_copies SET status = 'ISSUED' WHERE id = ?").run(copy.id);

      return info.lastInsertRowid;
    });

    const txId = tx();
    res.status(201).json({
      message: `Book copy "${copy.copy_code}" (${copy.book_title}) successfully issued to ${member.name}`,
      transactionId: txId,
      dueDate: formattedDueDate
    });
  } catch (error) {
    console.error('Issue error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Return a Book Copy
app.post('/api/transactions/return', (req, res) => {
  try {
    const { copy_code, return_condition = 'Good condition', fine = 0, notes = '', mark_status } = req.body;

    if (!copy_code) {
      return res.status(400).json({ error: 'Copy Code is required' });
    }

    // Find active transaction for this copy
    const activeTx = db.prepare(`
      SELECT t.*, c.id as copy_id, c.copy_code, b.title as book_title, m.name as member_name
      FROM transactions t
      JOIN book_copies c ON t.copy_id = c.id
      JOIN books b ON c.book_id = b.id
      JOIN members m ON t.member_id = m.id
      WHERE c.copy_code = ? COLLATE NOCASE AND t.status = 'ACTIVE'
    `).get(copy_code.trim());

    if (!activeTx) {
      return res.status(404).json({ error: `No active issued transaction found for Copy Code "${copy_code}"` });
    }

    // Determine final status of copy (e.g., if marked damaged or returned good)
    let newCopyStatus = 'AVAILABLE';
    if (mark_status && ['DAMAGED', 'MAINTENANCE', 'LOST'].includes(mark_status)) {
      newCopyStatus = mark_status;
    }

    const fineAmount = parseFloat(fine) || 0;

    const tx = db.transaction(() => {
      // 1. Close transaction
      db.prepare(`
        UPDATE transactions 
        SET status = 'RETURNED',
            return_date = datetime('now', 'localtime'),
            return_condition = ?,
            fine = ?,
            notes = CASE WHEN ? != '' THEN ? ELSE notes END
        WHERE id = ?
      `).run(return_condition, fineAmount, notes, notes, activeTx.id);

      // 2. Update copy status and condition note
      db.prepare(`
        UPDATE book_copies 
        SET status = ?,
            condition_note = ?
        WHERE id = ?
      `).run(newCopyStatus, return_condition, activeTx.copy_id);
    });

    tx();

    res.json({
      message: `Copy "${activeTx.copy_code}" returned successfully by ${activeTx.member_name}`,
      newStatus: newCopyStatus,
      recordedCondition: return_condition
    });
  } catch (error) {
    console.error('Return error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Active Checkouts
app.get('/api/transactions/active', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT t.*,
             c.copy_code,
             b.title as book_title,
             b.author as book_author,
             m.name as member_name,
             m.member_code,
             m.phone as member_phone,
             (datetime('now', 'localtime') > datetime(t.due_date)) as is_overdue,
             ROUND(JULIANDAY('now', 'localtime') - JULIANDAY(t.due_date)) as days_overdue
      FROM transactions t
      JOIN book_copies c ON t.copy_id = c.id
      JOIN books b ON c.book_id = b.id
      JOIN members m ON t.member_id = m.id
      WHERE t.status = 'ACTIVE'
      ORDER BY t.due_date ASC
    `).all();

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Complete History
app.get('/api/transactions/history', (req, res) => {
  try {
    const { q, limit = 100 } = req.query;
    let query = `
      SELECT t.*,
             c.copy_code,
             b.title as book_title,
             b.author as book_author,
             m.name as member_name,
             m.member_code
      FROM transactions t
      JOIN book_copies c ON t.copy_id = c.id
      JOIN books b ON c.book_id = b.id
      JOIN members m ON t.member_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      query += ` AND (c.copy_code LIKE ? OR b.title LIKE ? OR m.name LIKE ? OR m.member_code LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    query += ` ORDER BY t.id DESC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 6. BACKUP & CSV EXPORT APIs
// ==========================================
app.get('/api/export/backup', (req, res) => {
  const dbFile = path.join(__dirname, 'library.db');
  if (fs.existsSync(dbFile)) {
    const dateStr = new Date().toISOString().slice(0, 10);
    res.download(dbFile, `library_backup_${dateStr}.db`);
  } else {
    res.status(404).send('Database file not found');
  }
});

app.get('/api/export/csv/books', (req, res) => {
  try {
    const books = db.prepare(`
      SELECT b.id, b.isbn_or_code, b.title, b.author, b.category, b.edition, b.shelf_location,
             COUNT(c.id) as total_copies,
             SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END) as available_copies,
             SUM(CASE WHEN c.status = 'ISSUED' THEN 1 ELSE 0 END) as issued_copies
      FROM books b
      LEFT JOIN book_copies c ON b.id = c.book_id
      GROUP BY b.id
    `).all();

    let csv = 'ID,ISBN,Title,Author,Category,Edition,Shelf,Total Copies,Available,Issued\n';
    books.forEach(b => {
      const escape = s => `"${(s || '').toString().replace(/"/g, '""')}"`;
      csv += `${b.id},${escape(b.isbn_or_code)},${escape(b.title)},${escape(b.author)},${escape(b.category)},${escape(b.edition)},${escape(b.shelf_location)},${b.total_copies},${b.available_copies},${b.issued_copies}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="books_inventory.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  Library Management System (LMS) Server Running!`);
  console.log(`  Local URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
