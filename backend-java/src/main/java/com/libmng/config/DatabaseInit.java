package com.libmng.config;

import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DatabaseInit implements CommandLineRunner {

    private final JdbcTemplate jdbcTemplate;

    public DatabaseInit(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(String... args) {
        try {
            // Enable Foreign Keys for SQLite
            jdbcTemplate.execute("PRAGMA foreign_keys = ON;");
        } catch (Exception ignored) {
            // Non-SQLite databases will ignore this
        }

        // 1. Books Table
        jdbcTemplate.execute("""
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
        """);

        // 2. Book Copies Table
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS book_copies (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              book_id INTEGER NOT NULL,
              copy_code TEXT UNIQUE NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('AVAILABLE', 'ISSUED', 'DAMAGED', 'LOST', 'MAINTENANCE')) DEFAULT 'AVAILABLE',
              condition_note TEXT DEFAULT 'Good condition',
              added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
            );
        """);

        // 3. Members Table
        jdbcTemplate.execute("""
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
        """);

        // 4. Transactions Table
        jdbcTemplate.execute("""
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
        """);

        // Indices
        try {
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_copies_book ON book_copies(book_id);");
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_copies_code ON book_copies(copy_code);");
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_members_code ON members(member_code);");
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_trans_copy ON transactions(copy_id);");
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_trans_member ON transactions(member_id);");
            jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_trans_status ON transactions(status);");
        } catch (Exception e) {
            // Ignored if indices exist or unsupported
        }

        System.out.println("✅ Database schema initialized successfully.");
    }
}
