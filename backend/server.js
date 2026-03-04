const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURAZIONE DATABASE ---
const dbConfig = {
    // Se usi Docker, DB_HOST dovrebbe essere 'db'
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'calendar_user',
    password: process.env.DB_PASSWORD || 'calendar_password',
    database: process.env.DB_NAME || 'calendar_app'
};

let pool;
async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('✅ Connessione al database MySQL stabilita');
    } catch (err) {
        console.error('❌ Errore critico di connessione al DB:', err);
        process.exit(1); // Chiude il processo se il DB non è raggiungibile
    }
}
initDB();

// --- MIDDLEWARE DI AUTENTICAZIONE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Token mancante' });

    jwt.verify(token, process.env.JWT_SECRET || 'secret_key_2026', (err, user) => {
        if (err) return res.status(403).json({ error: 'Token non valido o scaduto' });
        req.user = user;
        next();
    });
};

// --- ROTTE AUTENTICAZIONE ---

// 1. Registrazione con Hashing
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Dati incompleti' });

        // Creazione Hash della password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Prepared Statement per prevenire SQL Injection
        const [result] = await pool.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );

        res.status(201).json({ message: 'Utente creato', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Username già esistente' });
        }
        res.status(500).json({ error: 'Errore durante la registrazione' });
    }
});

// 2. Login con confronto Hash
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Recupero utente tramite Prepared Statement
        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user) return res.status(401).json({ error: 'Utente non trovato' });

        // Confronto tra password in chiaro e hash nel DB
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Password errata' });

        // Generazione Token JWT
        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || 'secret_key_2026',
            { expiresIn: '24h' }
        );

        res.json({ token, username: user.username, userId: user.id });
    } catch (error) {
        res.status(500).json({ error: 'Errore nel processo di login' });
    }
});

// --- ROTTE CALENDARI ED EVENTI ---

// Recupera i calendari dell'utente (Creati automaticamente dal trigger SQL)
app.get('/api/calendars', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM calendars WHERE user_id = ?',
            [req.user.id]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Errore recupero calendari' });
    }
});

// Recupera eventi di un calendario specifico (con controllo proprietà)
app.get('/api/events/:calendarId', authenticateToken, async (req, res) => {
    try {
        const { calendarId } = req.params;

        // Sicurezza: Verifichiamo che il calendario appartenga all'utente loggato
        const [ownership] = await pool.execute(
            'SELECT id FROM calendars WHERE id = ? AND user_id = ?',
            [calendarId, req.user.id]
        );

        if (ownership.length === 0) return res.status(403).json({ error: 'Accesso negato' });

        const [events] = await pool.execute(
            'SELECT * FROM events WHERE calendar_id = ? ORDER BY event_date, event_time',
            [calendarId]
        );
        res.json(events);
    } catch (error) {
        res.status(500).json({ error: 'Errore recupero eventi' });
    }
});

// Crea un nuovo evento
app.post('/api/events', authenticateToken, async (req, res) => {
    try {
        const { calendar_id, title, event_date, event_time, description } = req.body;

        // Verifica proprietà del calendario prima di inserire
        const [ownership] = await pool.execute(
            'SELECT id FROM calendars WHERE id = ? AND user_id = ?',
            [calendar_id, req.user.id]
        );
        if (ownership.length === 0) return res.status(403).json({ error: 'Non puoi aggiungere eventi a questo calendario' });

        const [result] = await pool.execute(
            'INSERT INTO events (calendar_id, title, event_date, event_time, description) VALUES (?, ?, ?, ?, ?)',
            [calendar_id, title, event_date, event_time || null, description || '']
        );

        res.status(201).json({ id: result.insertId, message: 'Evento creato' });
    } catch (error) {
        res.status(500).json({ error: 'Errore creazione evento' });
    }
});

// --- LOGICA PADRE PIO ---
const pensieriPadrePio = [
    "Prega, spera e non agitarti. L'agitazione non giova a nulla.",
    "Il Signore ti benedica e ti faccia vedere il Suo volto.",
    "La preghiera è la migliore arma che abbiamo; è una chiave che apre il cuore di Dio.",
    "Abbi pazienza nel sopportare i tuoi difetti, come sopporti quelli degli altri.",
    "Non temere le avversità, sono le prove che rafforzano l'anima."
];

app.get('/api/padrepio/thought/:date', authenticateToken, (req, res) => {
    const dateStr = req.params.date; // Es: 2026-03-04
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % pensieriPadrePio.length;
    res.json({ date: dateStr, thought: pensieriPadrePio[index] });
});

// --- AVVIO SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server Backend pronto sulla porta ${PORT}`);
});