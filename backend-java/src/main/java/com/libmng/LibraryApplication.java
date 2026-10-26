package com.libmng;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class LibraryApplication {

    public static void main(String[] args) {
        SpringApplication.run(LibraryApplication.class, args);
        System.out.println("=================================================================");
        System.out.println("  📚 Java Spring Boot Library Management System Running!");
        System.out.println("  Local URL: http://localhost:8080");
        System.out.println("=================================================================");
    }
}
