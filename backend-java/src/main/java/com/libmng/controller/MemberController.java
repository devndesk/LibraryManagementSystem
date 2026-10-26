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
@RequestMapping("/api/members")
public class MemberController {

    private final JdbcTemplate jdbcTemplate;

    public MemberController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public ResponseEntity<?> getMembers(@RequestParam(required = false) String q) {
        try {
            StringBuilder sql = new StringBuilder("""
                SELECT m.*,
                  COUNT(CASE WHEN t.status = 'ACTIVE' THEN 1 END) as active_loans_count,
                  COUNT(t.id) as total_borrowed_count
                FROM members m
                LEFT JOIN transactions t ON m.id = t.member_id
                WHERE 1=1
            """);

            List<Object> params = new ArrayList<>();
            if (q != null && !q.trim().isEmpty()) {
                sql.append(" AND (m.name LIKE ? OR m.member_code LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)");
                String term = "%" + q.trim() + "%";
                params.add(term);
                params.add(term);
                params.add(term);
                params.add(term);
            }

            sql.append(" GROUP BY m.id ORDER BY m.name ASC");

            List<Map<String, Object>> members = jdbcTemplate.queryForList(sql.toString(), params.toArray());
            return ResponseEntity.ok(members);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping
    public ResponseEntity<?> createMember(@RequestBody Map<String, Object> body) {
        try {
            String name = (String) body.get("name");
            if (name == null || name.trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Member name is required"));
            }

            String code = (String) body.get("member_code");
            if (code == null || code.trim().isEmpty()) {
                Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM members", Integer.class);
                code = "MEM-" + (101 + (count != null ? count : 0));
            } else {
                code = code.trim();
            }

            final String memberCode = code;
            String email = (String) body.getOrDefault("email", "");
            String phone = (String) body.getOrDefault("phone", "");
            String role = (String) body.getOrDefault("role", "Student");

            KeyHolder keyHolder = new GeneratedKeyHolder();
            jdbcTemplate.update(connection -> {
                PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO members (member_code, name, email, phone, role, status)
                    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
                """, Statement.RETURN_GENERATED_KEYS);
                ps.setString(1, memberCode);
                ps.setString(2, name.trim());
                ps.setString(3, email != null ? email : "");
                ps.setString(4, phone != null ? phone : "");
                ps.setString(5, role != null ? role : "Student");
                return ps;
            }, keyHolder);

            Number id = keyHolder.getKey();

            Map<String, Object> resp = new HashMap<>();
            resp.put("message", "Member registered successfully");
            resp.put("memberId", id != null ? id.intValue() : 0);
            resp.put("member_code", memberCode);

            return ResponseEntity.status(HttpStatus.CREATED).body(resp);
        } catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("UNIQUE constraint failed: members.member_code")) {
                return ResponseEntity.badRequest().body(Map.of("error", "Member code already exists."));
            }
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> updateMember(@PathVariable int id, @RequestBody Map<String, Object> body) {
        try {
            int rows = jdbcTemplate.update("""
                UPDATE members 
                SET name = COALESCE(?, name),
                    email = COALESCE(?, email),
                    phone = COALESCE(?, phone),
                    role = COALESCE(?, role),
                    status = COALESCE(?, status)
                WHERE id = ?
            """,
                body.get("name"),
                body.get("email"),
                body.get("phone"),
                body.get("role"),
                body.get("status"),
                id
            );

            if (rows == 0) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Member not found"));
            }
            return ResponseEntity.ok(Map.of("message", "Member updated successfully"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> deleteMember(@PathVariable int id) {
        try {
            Integer activeLoans = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM transactions WHERE member_id = ? AND status = 'ACTIVE'",
                Integer.class, id
            );

            if (activeLoans != null && activeLoans > 0) {
                return ResponseEntity.badRequest().body(Map.of("error", "Cannot delete member. Member currently holds " + activeLoans + " unreturned book(s)."));
            }

            jdbcTemplate.update("DELETE FROM transactions WHERE member_id = ?", id);
            jdbcTemplate.update("DELETE FROM members WHERE id = ?", id);

            return ResponseEntity.ok(Map.of("message", "Member deleted successfully"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/{id}/history")
    public ResponseEntity<?> getMemberHistory(@PathVariable int id) {
        try {
            List<Map<String, Object>> history = jdbcTemplate.queryForList("""
                SELECT t.*, c.copy_code, b.title as book_title, b.author as book_author
                FROM transactions t
                JOIN book_copies c ON t.copy_id = c.id
                JOIN books b ON c.book_id = b.id
                WHERE t.member_id = ?
                ORDER BY t.id DESC
            """, id);
            return ResponseEntity.ok(history);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
