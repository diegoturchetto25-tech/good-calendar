CREATE DATABASE IF NOT EXISTS calendar_app;
USE calendar_app;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('Ufficio', 'Personale') NOT NULL,
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

-- Trigger: crea automaticamente i 2 calendari (Ufficio + Personale) alla registrazione
DELIMITER //
CREATE TRIGGER after_user_insert
AFTER INSERT ON users
FOR EACH ROW
BEGIN
    INSERT INTO calendars (user_id, type) VALUES (NEW.id, 'Ufficio');
    INSERT INTO calendars (user_id, type) VALUES (NEW.id, 'Personale');
END;
//
DELIMITER ;