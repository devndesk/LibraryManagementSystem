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
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/transactions")
public class TransactionController {

    private final JdbcTemplate jdbcTemplate;

    public TransactionController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostMapping("/issue")
    @Transactional
    public ResponseEntity<?> issueBook(@RequestBody Map<String, Object> body) {
        try {
            String copyCode = (String) body.get("copy_code");
            String memberCode = (String) body.get("member_code");

            if (copyCode == null || copyCode.trim().isEmpty() || memberCode == null || memberCode.trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Copy Code and Member Code are required"));
            }

            // 1. Find Copy
            List<Map<String, Object>> copies = jdbcTemplate.queryForList("""
                SELECT c.*, b.title as book_title
                FROM book_copies c
                JOIN books b ON c.book_id = b.id
                WHERE c.copy_code = ? COLLATE NOCASE
            """, copyCode.trim());

            if (copies.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Physical Copy \"" + copyCode + "\" not found in catalog"));
            }

            Map<String, Object> copy = copies.get(0);
            String copyStatus = (String) copy.get("status");
            int copyId = ((Number) copy.get("id")).intValue();

            if (!"AVAILABLE".equalsIgnoreCase(copyStatus)) {
                return ResponseEntity.badRequest().body(Map.of(
                    "error", "Copy \"" + copy.get("copy_code") + "\" is currently " + copyStatus + ". Only AVAILABLE copies can be issued."
                ));
            }

            // 2. Find Member
            List<Map<String, Object>> members = jdbcTemplate.queryForList("""
                SELECT * FROM members WHERE member_code = ? COLLATE NOCASE OR id = ?
            """, memberCode.trim(), memberCode.trim());

            if (members.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Member \"" + memberCode + "\" not found"));
            }

            Map<String, Object> member = members.get(0);
            String memberStatus = (String) member.get("status");
            int memberId = ((Number) member.get("id")).intValue();

            if (!"ACTIVE".equalsIgnoreCase(memberStatus)) {
                return ResponseEntity.badRequest().body(Map.of("error", "Member account is " + memberStatus + ". Cannot issue books."));
            }

            // Calculate due date
            int dueDays = 14;
            if (body.get("due_days") != null) {
                try {
                    dueDays = Math.max(1, Integer.parseInt(body.get("due_days").toString()));
                } catch (NumberFormatException ignored) {}
            }

            LocalDateTime dueDate = LocalDateTime.now().plusDays(dueDays);
            String formattedDueDate = dueDate.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
            String notes = (String) body.getOrDefault("notes", "Regular loan");

            KeyHolder keyHolder = new GeneratedKeyHolder();
            jdbcTemplate.update(connection -> {
                PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO transactions (copy_id, member_id, issue_date, due_date, status, notes)
                    VALUES (?, ?, datetime('now', 'localtime'), ?, 'ACTIVE', ?)
                """, Statement.RETURN_GENERATED_KEYS);
                ps.setInt(1, copyId);
                ps.setInt(2, memberId);
                ps.setString(3, formattedDueDate);
                ps.setString(4, notes != null && !notes.isEmpty() ? notes : "Regular loan");
                return ps;
            }, keyHolder);

            // Update copy status
            jdbcTemplate.update("UPDATE book_copies SET status = 'ISSUED' WHERE id = ?", copyId);

            Number txId = keyHolder.getKey();

            Map<String, Object> resp = new HashMap<>();
            resp.put("message", "Book copy \"" + copy.get("copy_code") + "\" (" + copy.get("book_title") + ") successfully issued to " + member.get("name"));
            resp.put("transactionId", txId != null ? txId.intValue() : 0);
            resp.put("dueDate", formattedDueDate);

            return ResponseEntity.status(HttpStatus.CREATED).body(resp);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/return")
    @Transactional
    public ResponseEntity<?> returnBook(@RequestBody Map<String, Object> body) {
        try {
            String copyCode = (String) body.get("copy_code");
            if (copyCode == null || copyCode.trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Copy Code is required"));
            }

            List<Map<String, Object>> activeTxs = jdbcTemplate.queryForList("""
                SELECT t.*, c.id as copy_id, c.copy_code, b.title as book_title, m.name as member_name
                FROM transactions t
                JOIN book_copies c ON t.copy_id = c.id
                JOIN books b ON c.book_id = b.id
                JOIN members m ON t.member_id = m.id
                WHERE c.copy_code = ? COLLATE NOCASE AND t.status = 'ACTIVE'
            """, copyCode.trim());

            if (activeTxs.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                    "error", "No active issued transaction found for Copy Code \"" + copyCode + "\""
                ));
            }

            Map<String, Object> activeTx = activeTxs.get(0);
            int txId = ((Number) activeTx.get("id")).intValue();
            int copyId = ((Number) activeTx.get("copy_id")).intValue();

            String condition = (String) body.getOrDefault("return_condition", "Good condition");
            String markStatus = (String) body.get("mark_status");

            String newCopyStatus = "AVAILABLE";
            if (markStatus != null && List.of("DAMAGED", "MAINTENANCE", "LOST").contains(markStatus.toUpperCase())) {
                newCopyStatus = markStatus.toUpperCase();
            }

            double fine = 0.0;
            if (body.get("fine") != null) {
                try {
                    fine = Double.parseDouble(body.get("fine").toString());
                } catch (NumberFormatException ignored) {}
            }

            String notes = (String) body.getOrDefault("notes", "");

            jdbcTemplate.update("""
                UPDATE transactions 
                SET status = 'RETURNED',
                    return_date = datetime('now', 'localtime'),
                    return_condition = ?,
                    fine = ?,
                    notes = CASE WHEN ? != '' THEN ? ELSE notes END
                WHERE id = ?
            """, condition, fine, notes, notes, txId);

            jdbcTemplate.update("""
                UPDATE book_copies 
                SET status = ?,
                    condition_note = ?
                WHERE id = ?
            """, newCopyStatus, condition, copyId);

            Map<String, Object> resp = new HashMap<>();
            resp.put("message", "Copy \"" + activeTx.get("copy_code") + "\" returned successfully by " + activeTx.get("member_name"));
            resp.put("newStatus", newCopyStatus);
            resp.put("recordedCondition", condition);

            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/active")
    public ResponseEntity<?> getActiveCheckouts() {
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
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
            """);
            return ResponseEntity.ok(rows);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/history")
    public ResponseEntity<?> getHistory(
            @RequestParam(required = false) String q,
            @RequestParam(required = false, defaultValue = "100") int limit) {
        try {
            StringBuilder sql = new StringBuilder("""
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
            """);

            List<Object> params = new ArrayList<>();
            if (q != null && !q.trim().isEmpty()) {
                sql.append(" AND (c.copy_code LIKE ? OR b.title LIKE ? OR m.name LIKE ? OR m.member_code LIKE ?)");
                String term = "%" + q.trim() + "%";
                params.add(term);
                params.add(term);
                params.add(term);
                params.add(term);
            }

            sql.append(" ORDER BY t.id DESC LIMIT ?");
            params.add(limit);

            List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql.toString(), params.toArray());
            return ResponseEntity.ok(rows);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/copy-history/{copyCode}")
    public ResponseEntity<?> getCopyHistory(@PathVariable String copyCode) {
        try {
            List<Map<String, Object>> copies = jdbcTemplate.queryForList("""
                SELECT c.*, b.title as book_title, b.author as book_author, b.category, b.edition, b.shelf_location
                FROM book_copies c
                JOIN books b ON c.book_id = b.id
                WHERE c.copy_code = ? COLLATE NOCASE
            """, copyCode.trim());

            if (copies.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "No physical copy found with Code: \"" + copyCode + "\""));
            }

            Map<String, Object> copy = copies.get(0);
            int copyId = ((Number) copy.get("id")).intValue();

            List<Map<String, Object>> active = jdbcTemplate.queryForList("""
                SELECT t.*, m.name as member_name, m.member_code, m.email, m.phone, m.role
                FROM transactions t
                JOIN members m ON t.member_id = m.id
                WHERE t.copy_id = ? AND t.status = 'ACTIVE'
            """, copyId);

            List<Map<String, Object>> history = jdbcTemplate.queryForList("""
                SELECT t.*, m.name as member_name, m.member_code, m.email, m.phone, m.role
                FROM transactions t
                JOIN members m ON t.member_id = m.id
                WHERE t.copy_id = ?
                ORDER BY t.id DESC
            """, copyId);

            List<Map<String, Object>> lastReturned = jdbcTemplate.queryForList("""
                SELECT t.*, m.name as member_name, m.member_code, m.email, m.phone, m.role
                FROM transactions t
                JOIN members m ON t.member_id = m.id
                WHERE t.copy_id = ? AND t.status = 'RETURNED'
                ORDER BY t.return_date DESC LIMIT 1
            """, copyId);

            Map<String, Object> resp = new HashMap<>();
            resp.put("copy", copy);
            resp.put("activeCheckout", !active.isEmpty() ? active.get(0) : null);
            resp.put("lastBorrower", !lastReturned.isEmpty() ? lastReturned.get(0) : null);
            resp.put("totalBorrowCount", history.size());
            resp.put("history", history);

            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
