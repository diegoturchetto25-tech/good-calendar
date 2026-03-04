const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURAZIONE DATABASE ---
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
        console.log('✅ Connessione al database MySQL stabilita');
    } catch (err) {
        console.error('❌ Errore critico di connessione al DB:', err);
        process.exit(1);
    }
}
initDB();

// --- CARICAMENTO CITAZIONI PADRE PIO ---
let padrePioQuotes = [];

function loadPadrePioQuotes() {
    const filePath = path.join(__dirname, 'padrepio.txt');
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        padrePioQuotes = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        console.log(`✅ Caricate ${padrePioQuotes.length} citazioni di Padre Pio`);
    } catch (err) {
        console.error('⚠️ Impossibile leggere padrepio.txt:', err.message);
        padrePioQuotes = [
            "Prega, spera e non agitarti. L'agitazione non giova a nulla.",
            "La preghiera è la migliore arma che abbiamo.",
            "Chi ha Dio ha tutto; chi non ha Dio non ha niente."
        ];
    }
}
loadPadrePioQuotes();

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

// 1. Registrazione
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Dati incompleti: username, email e password sono obbligatori.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.execute(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword]
        );

        res.status(201).json({ message: 'Utente creato con successo.', userId: result.insertId });

    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            // Messaggio specifico per capire se è username o email
            if (error.message.includes('username')) {
                return res.status(400).json({ error: 'Username già in uso. Scegli un username diverso.' });
            }
            if (error.message.includes('email')) {
                return res.status(400).json({ error: 'Email già registrata. Usa un\'altra email o accedi.' });
            }
            return res.status(400).json({ error: 'Username o email già esistenti.' });
        }
        console.error('Errore registrazione:', error);
        res.status(500).json({ error: 'Errore interno durante la registrazione.' });
    }
});

// 2. Login con EMAIL + PASSWORD
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email e password sono obbligatorie.' });
        }

        // Query per email (non username)
        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];

        if (!user) return res.status(401).json({ error: 'Nessun account trovato con questa email.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Password errata.' });

        const token = jwt.sign(
            { id: user.id, username: user.username },
            process.env.JWT_SECRET || 'secret_key_2026',
            { expiresIn: '24h' }
        );

        res.json({ token, username: user.username, userId: user.id });
    } catch (error) {
        console.error('Errore login:', error);
        res.status(500).json({ error: 'Errore interno nel processo di login.' });
    }
});

// 3. Cambio Password (protetto da JWT)
app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Vecchia password e nuova password sono obbligatorie.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'La nuova password deve avere almeno 6 caratteri.' });
        }

        if (oldPassword === newPassword) {
            return res.status(400).json({ error: 'La nuova password deve essere diversa da quella attuale.' });
        }

        // Recupera utente corrente
        const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const user = rows[0];

        if (!user) return res.status(404).json({ error: 'Utente non trovato.' });

        // Verifica vecchia password
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'La password attuale non è corretta.' });

        // Hash nuova password e salva
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, req.user.id]);

        res.json({ message: 'Password aggiornata con successo.' });
    } catch (error) {
        console.error('Errore cambio password:', error);
        res.status(500).json({ error: 'Errore interno durante il cambio password.' });
    }
});

// --- ROTTE CALENDARI ---

// Recupera i calendari dell'utente
app.get('/api/calendars', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM calendars WHERE user_id = ?',
            [req.user.id]
        );
        res.json(rows);
    } catch (error) {
        console.error('Errore recupero calendari:', error);
        res.status(500).json({ error: 'Errore recupero calendari.' });
    }
});

// --- ROTTE EVENTI ---

// Recupera eventi di un calendario specifico (con controllo proprietà)
app.get('/api/events/:calendarId', authenticateToken, async (req, res) => {
    try {
        const { calendarId } = req.params;

        const [ownership] = await pool.execute(
            'SELECT id FROM calendars WHERE id = ? AND user_id = ?',
            [calendarId, req.user.id]
        );
        if (ownership.length === 0) return res.status(403).json({ error: 'Accesso negato a questo calendario.' });

        const [events] = await pool.execute(
            'SELECT * FROM events WHERE calendar_id = ? ORDER BY event_date, event_time',
            [calendarId]
        );
        res.json(events);
    } catch (error) {
        console.error('Errore recupero eventi:', error);
        res.status(500).json({ error: 'Errore recupero eventi.' });
    }
});

// Crea un nuovo evento (con controllo sovrapposizione CROSS-CALENDAR)
app.post('/api/events', authenticateToken, async (req, res) => {
    try {
        const { calendar_id, title, event_date, event_time, event_end_time, description } = req.body;

        if (!calendar_id || !title || !event_date) {
            return res.status(400).json({ error: 'Calendario, titolo e data sono obbligatori.' });
        }

        // Verifica proprietà del calendario
        const [ownership] = await pool.execute(
            'SELECT id FROM calendars WHERE id = ? AND user_id = ?',
            [calendar_id, req.user.id]
        );
        if (ownership.length === 0) {
            return res.status(403).json({ error: 'Non puoi aggiungere eventi a questo calendario.' });
        }

        // Controllo sovrapposizione se entrambi i tempi sono forniti
        if (event_time && event_end_time) {
            if (event_time >= event_end_time) {
                return res.status(400).json({ error: 'L\'ora di fine deve essere successiva all\'ora di inizio.' });
            }

            // Cerca eventi sovrapposti in TUTTI i calendari dell'utente nella stessa data
            const [overlapping] = await pool.execute(
                `SELECT e.id, e.title, e.event_time, e.event_end_time, c.type AS calendar_type
                 FROM events e
                 JOIN calendars c ON e.calendar_id = c.id
                 WHERE c.user_id = ?
                   AND e.event_date = ?
                   AND e.event_time IS NOT NULL
                   AND e.event_end_time IS NOT NULL
                   AND ? < e.event_end_time
                   AND ? > e.event_time`,
                [req.user.id, event_date, event_time, event_end_time]
            );

            if (overlapping.length > 0) {
                const conflict = overlapping[0];
                return res.status(400).json({
                    error: `Conflitto di orario: l'evento si sovrappone con "${conflict.title}" (${conflict.event_time.substring(0,5)}–${conflict.event_end_time.substring(0,5)}) nel calendario "${conflict.calendar_type}".`
                });
            }
        }

        const [result] = await pool.execute(
            'INSERT INTO events (calendar_id, title, event_date, event_time, event_end_time, description) VALUES (?, ?, ?, ?, ?, ?)',
            [calendar_id, title, event_date, event_time || null, event_end_time || null, description || '']
        );

        res.status(201).json({ id: result.insertId, message: 'Evento creato con successo.' });
    } catch (error) {
        console.error('Errore creazione evento:', error);
        res.status(500).json({ error: 'Errore interno durante la creazione dell\'evento.' });
    }
});

// Elimina un evento (con controllo proprietà)
app.delete('/api/events/:eventId', authenticateToken, async (req, res) => {
    try {
        const { eventId } = req.params;

        // Verifica che l'evento appartenga a un calendario dell'utente loggato
        const [ownership] = await pool.execute(
            `SELECT e.id FROM events e
             JOIN calendars c ON e.calendar_id = c.id
             WHERE e.id = ? AND c.user_id = ?`,
            [eventId, req.user.id]
        );
        if (ownership.length === 0) return res.status(403).json({ error: 'Accesso negato.' });

        await pool.execute('DELETE FROM events WHERE id = ?', [eventId]);
        res.json({ message: 'Evento eliminato.' });
    } catch (error) {
        console.error('Errore eliminazione evento:', error);
        res.status(500).json({ error: 'Errore durante l\'eliminazione dell\'evento.' });
    }
});

// --- PENSIERO DI PADRE PIO (deterministico per data, integrato nel calendario Personale) ---
app.get('/api/padrepio/thought/:date', authenticateToken, (req, res) => {
    if (padrePioQuotes.length === 0) {
        return res.status(503).json({ error: 'Citazioni non disponibili.' });
    }

    const dateStr = req.params.date; // Es: 2026-03-04
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % padrePioQuotes.length;
    res.json({ date: dateStr, thought: padrePioQuotes[index] });
});

// --- AVVIO SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server Backend pronto sulla porta ${PORT}`);
});