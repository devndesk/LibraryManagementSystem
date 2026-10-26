package com.libmng.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/stats")
public class StatsController {

    private final JdbcTemplate jdbcTemplate;

    public StatsController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public ResponseEntity<?> getStats() {
        try {
            Integer totalTitles = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM books", Integer.class);
            Integer totalCopies = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_copies", Integer.class);
            Integer availableCopies = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_copies WHERE status = 'AVAILABLE'", Integer.class);
            Integer issuedCopies = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_copies WHERE status = 'ISSUED'", Integer.class);
            Integer damagedCopies = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM book_copies WHERE status IN ('DAMAGED', 'LOST', 'MAINTENANCE')", Integer.class);
            Integer totalMembers = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM members", Integer.class);

            Integer overdueCount = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM transactions 
                WHERE status = 'ACTIVE' AND datetime(due_date) < datetime('now', 'localtime')
            """, Integer.class);

            List<Map<String, Object>> recentActivity = jdbcTemplate.queryForList("""
                SELECT t.id, t.status, t.issue_date, t.return_date, t.due_date,
                       c.copy_code, b.title as book_title, m.name as member_name, m.member_code
                FROM transactions t
                JOIN book_copies c ON t.copy_id = c.id
                JOIN books b ON c.book_id = b.id
                JOIN members m ON t.member_id = m.id
                ORDER BY t.id DESC LIMIT 8
            """);

            Map<String, Object> response = new HashMap<>();
            response.put("totalTitles", totalTitles != null ? totalTitles : 0);
            response.put("totalCopies", totalCopies != null ? totalCopies : 0);
            response.put("availableCopies", availableCopies != null ? availableCopies : 0);
            response.put("issuedCopies", issuedCopies != null ? issuedCopies : 0);
            response.put("damagedCopies", damagedCopies != null ? damagedCopies : 0);
            response.put("overdueCount", overdueCount != null ? overdueCount : 0);
            response.put("totalMembers", totalMembers != null ? totalMembers : 0);
            response.put("recentActivity", recentActivity);

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            Map<String, String> err = new HashMap<>();
            err.put("error", e.getMessage());
            return ResponseEntity.internalServerError().body(err);
        }
    }
}
