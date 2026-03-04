const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'calendar_user',
    password: process.env.DB_PASSWORD || 'calendar_password',
    database: process.env.DB_NAME || 'calendar_app'
};

let pool;
async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('Connesso al database MySQL');
    } catch (err) {
        console.error('Errore di connessione al DB:', err);
    }
}
initDB();

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- ROUTES AUTH ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Dati mancanti' });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // PREPARED STATEMENT: I valori sono passati separatamente dalla stringa SQL
        const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
        const [result] = await pool.execute(query, [username, hashedPassword]);
        
        res.status(201).json({ message: 'Utente creato', userId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Errore registrazione. Username forse già in uso.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // PREPARED STATEMENT
        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        
        if (rows.length === 0) return res.status(400).json({ error: 'Utente non trovato' });

        const user = rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: 'Password errata' });

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
        res.json({ token, username: user.username, userId: user.id });
    } catch (error) {
        res.status(500).json({ error: 'Errore server' });
    }
});

// --- ROUTES CALENDARI & EVENTI ---
app.get('/api/calendars', authenticateToken, async (req, res) => {
    try {
        // PREPARED STATEMENT
        const [rows] = await pool.execute('SELECT * FROM calendars WHERE user_id = ?', [req.user.id]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Errore recupero calendari' });
    }
});

app.get('/api/events/:calendarId', authenticateToken, async (req, res) => {
    try {
        const { calendarId } = req.params;

        // Verifica proprietà con PREPARED STATEMENT
        const [calCheck] = await pool.execute(
            'SELECT id FROM calendars WHERE id = ? AND user_id = ?', 
            [calendarId, req.user.id]
        );
        
        if (calCheck.length === 0) return res.status(403).json({ error: 'Accesso negato al calendario' });

        const [events] = await pool.execute(
            'SELECT * FROM events WHERE calendar_id = ? ORDER BY event_date, event_time', 
            [calendarId]
        );
        res.json(events);
    } catch (error) {
        res.status(500).json({ error: 'Errore recupero eventi' });
    }
});

app.post('/api/events', authenticateToken, async (req, res) => {
    try {
        const { calendar_id, title, event_date, event_time, description } = req.body;
        
        if (!calendar_id || !title || !event_date) {
            return res.status(400).json({ error: 'Campi obbligatori mancanti' });
        }

        // Verifica proprietà con PREPARED STATEMENT
        const [calCheck] = await pool.execute(
            'SELECT id FROM calendars WHERE id = ? AND user_id = ?', 
            [calendar_id, req.user.id]
        );
        
        if (calCheck.length === 0) return res.status(403).json({ error: 'Accesso negato' });

        // Inserimento con PREPARED STATEMENT
        const [result] = await pool.execute(
            'INSERT INTO events (calendar_id, title, event_date, event_time, description) VALUES (?, ?, ?, ?, ?)',
            [calendar_id, title, event_date, event_time || null, description || '']
        );
        
        res.status(201).json({ id: result.insertId, message: 'Evento creato' });
    } catch (error) {
        res.status(500).json({ error: 'Errore creazione evento' });
    }
});

// --- FUNZIONE SPECIFICA: Pensiero di Padre Pio ---
const pensieriPadrePio = [
    "Prega, spera e non agitarti. L'agitazione non giova a nulla. Dio è misericordioso e ascolterà la tua preghiera.",
    "Il Signore ti benedica e ti faccia vedere il Suo volto.",
    "La preghiera è la migliore arma che abbiamo; è una chiave che apre il cuore di Dio.",
    "Abbi pazienza nel sopportare i tuoi difetti, come sopporti quelli degli altri.",
    "Non temere le avversità, sono le prove che rafforzano l'anima."
];

app.get('/api/padrepio/thought/:date', authenticateToken, (req, res) => {
    const dateStr = req.params.date; 
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % pensieriPadrePio.length;
    res.json({ date: dateStr, thought: pensieriPadrePio[index] });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend in esecuzione sulla porta ${PORT}`));