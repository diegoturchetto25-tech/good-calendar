CREATE DATABASE IF NOT EXISTS calendar_app;
USE calendar_app;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'capo', 'user') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- user_id è NULL per il calendario Ufficio globale condiviso
CREATE TABLE IF NOT EXISTS calendars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    type ENUM('Ufficio', 'Personale') NOT NULL,
    is_global BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    calendar_id INT NOT NULL,
    title VARCHAR(100) NOT NULL,
    event_date DATE NOT NULL,
    event_time TIME,
    event_end_time TIME,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
);

-- Unico calendario Ufficio globale condiviso da tutti
INSERT INTO calendars (user_id, type, is_global) VALUES (NULL, 'Ufficio', TRUE);

-- Trigger: ogni nuovo utente riceve solo il suo calendario Personale privato
DELIMITER //
CREATE TRIGGER after_user_insert
AFTER INSERT ON users
FOR EACH ROW
BEGIN
    INSERT INTO calendars (user_id, type, is_global) VALUES (NEW.id, 'Personale', FALSE);
END;
//
DELIMITER ;