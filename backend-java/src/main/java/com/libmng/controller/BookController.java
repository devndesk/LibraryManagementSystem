package com.libmng.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.*;

@RestController
@RequestMapping("/api")
public class BookController {

    private final JdbcTemplate jdbcTemplate;

    public BookController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/books")
    public ResponseEntity<?> getBooks(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String status) {
        try {
            StringBuilder sql = new StringBuilder("""
                SELECT b.*,
                  COUNT(c.id) as total_copies,
                  SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END) as available_copies,
                  SUM(CASE WHEN c.status = 'ISSUED' THEN 1 ELSE 0 END) as issued_copies,
                  SUM(CASE WHEN c.status IN ('DAMAGED', 'LOST', 'MAINTENANCE') THEN 1 ELSE 0 END) as damaged_copies
                FROM books b
                LEFT JOIN book_copies c ON b.id = c.book_id
                WHERE 1=1
            """);

            List<Object> params = new ArrayList<>();

            if (q != null && !q.trim().isEmpty()) {
                sql.append(" AND (b.title LIKE ? OR b.author LIKE ? OR b.isbn_or_code LIKE ? OR b.category LIKE ?)");
                String term = "%" + q.trim() + "%";
                params.add(term);
                params.add(term);
                params.add(term);
                params.add(term);
            }

            if (category != null && !category.trim().isEmpty() && !"ALL".equalsIgnoreCase(category)) {
                sql.append(" AND b.category = ?");
                params.add(category.trim());
            }

            sql.append(" GROUP BY b.id ORDER BY b.id DESC");

            List<Map<String, Object>> books = jdbcTemplate.queryForList(sql.toString(), params.toArray());

            if (status != null && !status.trim().isEmpty()) {
                if ("IN_STOCK".equalsIgnoreCase(status)) {
                    books = books.stream().filter(b -> {
                        Object avail = b.get("available_copies");
                        return avail != null && ((Number) avail).intValue() > 0;
                    }).toList();
                } else if ("OUT_OF_STOCK".equalsIgnoreCase(status)) {
                    books = books.stream().filter(b -> {
                        Object avail = b.get("available_copies");
                        return avail == null || ((Number) avail).intValue() == 0;
                    }).toList();
                }
            }

            return ResponseEntity.ok(books);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/categories")
    public ResponseEntity<?> getCategories() {
        try {
            List<String> categories = jdbcTemplate.queryForList(
                    "SELECT DISTINCT category FROM books WHERE category IS NOT NULL AND category != '' ORDER BY category ASC",
                    String.class
            );
            return ResponseEntity.ok(categories);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/books/{id}")
    public ResponseEntity<?> getBookById(@PathVariable int id) {
        try {
            List<Map<String, Object>> books = jdbcTemplate.queryForList("SELECT * FROM books WHERE id = ?", id);
            if (books.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Book not found"));
            }

            Map<String, Object> book = new HashMap<>(books.get(0));

            List<Map<String, Object>> copies = jdbcTemplate.queryForList("""
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
            """, id);

            book.put("copies", copies);
            return ResponseEntity.ok(book);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/books")
    @Transactional
    public ResponseEntity<?> createBook(@RequestBody Map<String, Object> body) {
        try {
            String title = (String) body.get("title");
            String author = (String) body.get("author");
            if (title == null || title.trim().isEmpty() || author == null || author.trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Title and Author are required"));
            }

            String category = (String) body.getOrDefault("category", "General");
            String isbn = (String) body.getOrDefault("isbn_or_code", "");
            String edition = (String) body.getOrDefault("edition", "");
            String shelf = (String) body.getOrDefault("shelf_location", "");
            String description = (String) body.getOrDefault("description", "");

            int copyCount = 1;
            if (body.get("copy_count") != null) {
                try {
                    copyCount = Math.max(1, Integer.parseInt(body.get("copy_count").toString()));
                } catch (NumberFormatException ignored) {}
            }

            String copyPrefix = (String) body.get("copy_prefix");
            if (copyPrefix == null || copyPrefix.trim().isEmpty()) {
                String clean = title.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
                copyPrefix = clean.length() >= 3 ? clean.substring(0, 3) : "BK";
            }
            final String prefix = copyPrefix.trim();

            KeyHolder keyHolder = new GeneratedKeyHolder();
            jdbcTemplate.update(connection -> {
                PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO books (isbn_or_code, title, author, category, edition, shelf_location, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, Statement.RETURN_GENERATED_KEYS);
                ps.setString(1, isbn);
                ps.setString(2, title.trim());
                ps.setString(3, author.trim());
                ps.setString(4, category);
                ps.setString(5, edition);
                ps.setString(6, shelf);
                ps.setString(7, description);
                return ps;
            }, keyHolder);

            Number generatedId = keyHolder.getKey();
            int bookId = generatedId != null ? generatedId.intValue() : 0;

            List<String> createdCopies = new ArrayList<>();
            for (int i = 1; i <= copyCount; i++) {
                String copyCode = String.format("%s-%03d", prefix, i);
                jdbcTemplate.update("""
                    INSERT INTO book_copies (book_id, copy_code, status, condition_note)
                    VALUES (?, ?, 'AVAILABLE', 'Good condition')
                """, bookId, copyCode);
                createdCopies.add(copyCode);
            }

            Map<String, Object> resp = new HashMap<>();
            resp.put("message", "Book \"" + title + "\" created with " + createdCopies.size() + " physical copies");
            resp.put("bookId", bookId);
            resp.put("copies", createdCopies);

            return ResponseEntity.status(HttpStatus.CREATED).body(resp);
        } catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("UNIQUE constraint failed: book_copies.copy_code")) {
                return ResponseEntity.badRequest().body(Map.of("error", "A copy with this prefix/code already exists. Please choose a distinct copy prefix."));
            }
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/books/{id}")
    public ResponseEntity<?> updateBook(@PathVariable int id, @RequestBody Map<String, Object> body) {
        try {
            int rows = jdbcTemplate.update("""
                UPDATE books 
                SET title = ?, author = ?, category = ?, isbn_or_code = ?, edition = ?, shelf_location = ?, description = ?
                WHERE id = ?
            """,
                body.get("title"),
                body.get("author"),
                body.get("category"),
                body.get("isbn_or_code"),
                body.get("edition"),
                body.get("shelf_location"),
                body.get("description"),
                id
            );

            if (rows == 0) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Book not found"));
            }
            return ResponseEntity.ok(Map.of("message", "Book updated successfully"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/books/{id}")
    @Transactional
    public ResponseEntity<?> deleteBook(@PathVariable int id) {
        try {
            Integer issuedCopies = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM book_copies WHERE book_id = ? AND status = 'ISSUED'",
                Integer.class, id
            );

            if (issuedCopies != null && issuedCopies > 0) {
                return ResponseEntity.badRequest().body(Map.of("error", "Cannot delete book. " + issuedCopies + " copy(ies) are currently issued to members."));
            }

            jdbcTemplate.update("DELETE FROM transactions WHERE copy_id IN (SELECT id FROM book_copies WHERE book_id = ?)", id);
            jdbcTemplate.update("DELETE FROM book_copies WHERE book_id = ?", id);
            jdbcTemplate.update("DELETE FROM books WHERE id = ?", id);

            return ResponseEntity.ok(Map.of("message", "Book and its copies deleted successfully"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/books/{id}/copies")
    @Transactional
    public ResponseEntity<?> addExtraCopies(@PathVariable int id, @RequestBody Map<String, Object> body) {
        try {
            List<Map<String, Object>> books = jdbcTemplate.queryForList("SELECT * FROM books WHERE id = ?", id);
            if (books.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Book not found"));
            }

            int count = 1;
            if (body.get("count") != null) {
                try {
                    count = Math.max(1, Integer.parseInt(body.get("count").toString()));
                } catch (NumberFormatException ignored) {}
            }

            String prefix = (String) body.getOrDefault("prefix", "CPY");
            if (prefix == null || prefix.trim().isEmpty()) prefix = "CPY";
            prefix = prefix.trim();

            Integer existingCount = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_copies WHERE book_id = ?", Integer.class, id);
            int baseNum = existingCount != null ? existingCount : 0;

            List<String> added = new ArrayList<>();
            for (int i = 1; i <= count; i++) {
                String copyCode = String.format("%s-%03d", prefix, baseNum + i);
                jdbcTemplate.update("""
                    INSERT INTO book_copies (book_id, copy_code, status, condition_note)
                    VALUES (?, ?, 'AVAILABLE', 'Good condition')
                """, id, copyCode);
                added.add(copyCode);
            }

            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "message", "Added " + added.size() + " new copies",
                "added", added
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/copies/{id}")
    public ResponseEntity<?> updateCopy(@PathVariable int id, @RequestBody Map<String, Object> body) {
        try {
            String status = (String) body.get("status");
            String note = (String) body.get("condition_note");

            int rows = jdbcTemplate.update("""
                UPDATE book_copies 
                SET status = COALESCE(?, status), condition_note = COALESCE(?, condition_note)
                WHERE id = ?
            """, status, note, id);

            if (rows == 0) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Copy not found"));
            }
            return ResponseEntity.ok(Map.of("message", "Copy updated successfully"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/copies/search")
    public ResponseEntity<?> searchCopies(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String available_only) {
        try {
            StringBuilder sql = new StringBuilder("""
                SELECT c.*, b.title as book_title, b.author as book_author, b.category
                FROM book_copies c
                JOIN books b ON c.book_id = b.id
                WHERE 1=1
            """);

            List<Object> params = new ArrayList<>();
            if (q != null && !q.trim().isEmpty()) {
                sql.append(" AND (c.copy_code LIKE ? OR b.title LIKE ?)");
                String term = "%" + q.trim() + "%";
                params.add(term);
                params.add(term);
            }

            if ("true".equalsIgnoreCase(available_only)) {
                sql.append(" AND c.status = 'AVAILABLE'");
            }

            sql.append(" ORDER BY c.copy_code ASC LIMIT 25");

            List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql.toString(), params.toArray());
            return ResponseEntity.ok(rows);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
