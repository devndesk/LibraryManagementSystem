package com.libmng.controller;

import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.File;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/export")
public class ExportController {

    private final JdbcTemplate jdbcTemplate;

    public ExportController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/backup")
    public ResponseEntity<Resource> downloadBackup() {
        File dbFile = new File("../library.db");
        if (!dbFile.exists()) {
            dbFile = new File("library.db");
        }

        if (!dbFile.exists()) {
            return ResponseEntity.notFound().build();
        }

        String filename = "library_backup_" + LocalDate.now() + ".db";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(new FileSystemResource(dbFile));
    }

    @GetMapping("/csv/books")
    public ResponseEntity<String> exportBooksCsv() {
        try {
            List<Map<String, Object>> books = jdbcTemplate.queryForList("""
                SELECT b.id, b.isbn_or_code, b.title, b.author, b.category, b.edition, b.shelf_location,
                       COUNT(c.id) as total_copies,
                       SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END) as available_copies,
                       SUM(CASE WHEN c.status = 'ISSUED' THEN 1 ELSE 0 END) as issued_copies
                FROM books b
                LEFT JOIN book_copies c ON b.id = c.book_id
                GROUP BY b.id
            """);

            StringBuilder csv = new StringBuilder("ID,ISBN,Title,Author,Category,Edition,Shelf,Total Copies,Available,Issued\n");
            for (Map<String, Object> b : books) {
                csv.append(escape(b.get("id"))).append(",")
                   .append(escape(b.get("isbn_or_code"))).append(",")
                   .append(escape(b.get("title"))).append(",")
                   .append(escape(b.get("author"))).append(",")
                   .append(escape(b.get("category"))).append(",")
                   .append(escape(b.get("edition"))).append(",")
                   .append(escape(b.get("shelf_location"))).append(",")
                   .append(escape(b.get("total_copies"))).append(",")
                   .append(escape(b.get("available_copies"))).append(",")
                   .append(escape(b.get("issued_copies"))).append("\n");
            }

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"books_inventory.csv\"")
                    .contentType(MediaType.parseMediaType("text/csv"))
                    .body(csv.toString());
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body("Error: " + e.getMessage());
        }
    }

    private String escape(Object obj) {
        if (obj == null) return "\"\"";
        return "\"" + obj.toString().replace("\"", "\"\"") + "\"";
    }
}
