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

const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_2026';

// --- DATABASE ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'calendar_user',
    password: process.env.DB_PASSWORD || 'calendar_password',
    database: process.env.DB_NAME || 'calendar_app'
};

let pool;

async function initDB() {
    pool = mysql.createPool(dbConfig);
    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            await pool.execute('SELECT 1');
            console.log('✅ Connessione al database MySQL stabilita');
            await initAdminUser();
            await initGlobalOfficeCalendar();
            return;
        } catch (err) {
            console.warn(`⏳ DB non pronto (tentativo ${attempt}/10): ${err.message}`);
            if (attempt === 10) {
                console.error('❌ Impossibile connettersi al DB dopo 10 tentativi.');
                process.exit(1);
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// Crea l'utente admin e gli utenti di test se non esistono
async function initAdminUser() {
    try {
        const testUsers = [
            { username: 'admin',   email: 'admin@calendar.local',  password: 'password', role: 'admin' },
            { username: 'mario',   email: 'mario.rossi@test.local', password: 'password', role: 'user'  },
            { username: 'luisa',   email: 'luisa.verdi@test.local', password: 'password', role: 'user'  },
            { username: 'diego',   email: 'diego.turchetto@test.local', password: 'password', role: 'user' },
            { username: 'daniele', email: 'daniele.gobbo@test.local',   password: 'password', role: 'user' },
        ];

        for (const u of testUsers) {
            const [rows] = await pool.execute(
                'SELECT id FROM users WHERE email = ?', [u.email]
            );
            if (rows.length === 0) {
                const hashed = await bcrypt.hash(u.password, 10);
                await pool.execute(
                    'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
                    [u.username, u.email, hashed, u.role]
                );
                console.log(`✅ Utente creato — ${u.email} (${u.role})`);
            } else {
                console.log(`ℹ️  Utente già esistente — ${u.email}`);
            }
        }
    } catch (err) {
        console.error('⚠️  Errore creazione utenti di test (non fatale):', err.message);
    }
}

// Garantisce l'esistenza dell'unico calendario Ufficio globale condiviso
async function initGlobalOfficeCalendar() {
    try {
        const [rows] = await pool.execute(
            'SELECT id FROM calendars WHERE is_global = TRUE AND type = ?', ['Ufficio']
        );
        if (rows.length === 0) {
            await pool.execute(
                'INSERT INTO calendars (user_id, type, is_global) VALUES (NULL, ?, TRUE)', ['Ufficio']
            );
            console.log('✅ Calendario Ufficio globale creato');
        }
    } catch (err) {
        console.error('⚠️ Errore init calendario Ufficio:', err.message);
    }
}

initDB();

// --- CITAZIONI PADRE PIO ---
let padrePioQuotes = [];
function loadPadrePioQuotes() {
    const filePath = path.join(__dirname, 'padrepio.txt');
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        padrePioQuotes = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        console.log(`✅ Caricate ${padrePioQuotes.length} citazioni di Padre Pio`);
    } catch (err) {
        console.error('⚠️ padrepio.txt non trovato:', err.message);
        padrePioQuotes = ["Prega, spera e non agitarti. L'agitazione non giova a nulla."];
    }
}
loadPadrePioQuotes();

// ============================================================
// MIDDLEWARE
// ============================================================

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token mancante.' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token non valido o scaduto.' });
        req.user = user; // { id, username, role }
        next();
    });
};

// Verifica ruolo server-side — non si fida mai del frontend
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({
            error: `Permesso negato. Ruolo richiesto: ${roles.join(' o ')}. Ruolo attuale: ${req.user?.role || 'nessuno'}.`
        });
    }
    next();
};

// ============================================================
// AUTH ROUTES
// ============================================================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password)
            return res.status(400).json({ error: 'Username, email e password sono obbligatori.' });
        if (password.length < 6)
            return res.status(400).json({ error: 'La password deve avere almeno 6 caratteri.' });

        const hashed = await bcrypt.hash(password, 10);
        const [result] = await pool.execute(
            'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
            [username, email, hashed, 'user']
        );
        res.status(201).json({ message: 'Utente creato con successo.', userId: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            if (error.message.includes('username'))
                return res.status(400).json({ error: 'Username già in uso. Scegline un altro.' });
            if (error.message.includes('email'))
                return res.status(400).json({ error: 'Email già registrata. Accedi o usa un\'altra email.' });
            return res.status(400).json({ error: 'Username o email già esistenti.' });
        }
        console.error('Errore registrazione:', error);
        res.status(500).json({ error: 'Errore interno durante la registrazione.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email e password sono obbligatorie.' });

        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
        const user = rows[0];
        if (!user) return res.status(401).json({ error: 'Nessun account trovato con questa email.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: 'Password errata.' });

        // Il ruolo è incluso nel token e verificato server-side ad ogni richiesta
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({ token, username: user.username, userId: user.id, role: user.role });
    } catch (error) {
        console.error('Errore login:', error);
        res.status(500).json({ error: 'Errore interno nel processo di login.' });
    }
});

app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword)
            return res.status(400).json({ error: 'Vecchia e nuova password sono obbligatorie.' });
        if (newPassword.length < 6)
            return res.status(400).json({ error: 'La nuova password deve avere almeno 6 caratteri.' });
        if (oldPassword === newPassword)
            return res.status(400).json({ error: 'La nuova password deve essere diversa dall\'attuale.' });

        const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const user = rows[0];
        if (!user) return res.status(404).json({ error: 'Utente non trovato.' });

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(401).json({ error: 'La password attuale non è corretta.' });

        const hashed = await bcrypt.hash(newPassword, 10);
        await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
        res.json({ message: 'Password aggiornata con successo.' });
    } catch (error) {
        console.error('Errore cambio password:', error);
        res.status(500).json({ error: 'Errore interno durante il cambio password.' });
    }
});

// ============================================================
// CALENDAR ROUTES
// ============================================================

// Restituisce: calendario Personale dell'utente + calendario Ufficio globale condiviso
app.get('/api/calendars', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM calendars
             WHERE (user_id = ? AND is_global = FALSE)
                OR (is_global = TRUE)
             ORDER BY is_global ASC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (error) {
        console.error('Errore recupero calendari:', error);
        res.status(500).json({ error: 'Errore recupero calendari.' });
    }
});

// ============================================================
// EVENT ROUTES
// ============================================================

/**
 * GET /api/events/:calendarId
 * - Calendario Ufficio (globale): restituisce eventi Ufficio (source: 'office')
 * - Calendario Personale: restituisce eventi personali (source: 'personal')
 *   + eventi Ufficio (source: 'office') in vista combinata
 */
app.get('/api/events/:calendarId', authenticateToken, async (req, res) => {
    try {
        const calendarId = parseInt(req.params.calendarId);

        const [calRows] = await pool.execute('SELECT * FROM calendars WHERE id = ?', [calendarId]);
        const calendar = calRows[0];
        if (!calendar) return res.status(404).json({ error: 'Calendario non trovato.' });

        // Verifica accesso: deve essere il proprio calendario personale O un calendario globale
        if (!calendar.is_global && calendar.user_id !== req.user.id)
            return res.status(403).json({ error: 'Accesso negato a questo calendario.' });

        if (calendar.is_global) {
            // Vista Ufficio: solo eventi ufficio
            const [events] = await pool.execute(
                `SELECT *, 'office' AS source FROM events
                 WHERE calendar_id = ? ORDER BY event_date, event_time`,
                [calendarId]
            );
            return res.json(events);
        }

        // Vista Personale: eventi personali + eventi ufficio globale (combinati)
        const [personalEvents] = await pool.execute(
            `SELECT *, 'personal' AS source FROM events WHERE calendar_id = ?`,
            [calendarId]
        );

        const [officeCalRows] = await pool.execute(
            'SELECT id FROM calendars WHERE is_global = TRUE AND type = ?', ['Ufficio']
        );

        let officeEvents = [];
        if (officeCalRows.length > 0) {
            const [rows] = await pool.execute(
                `SELECT *, 'office' AS source FROM events WHERE calendar_id = ?`,
                [officeCalRows[0].id]
            );
            officeEvents = rows;
        }

        const combined = [...personalEvents, ...officeEvents].sort((a, b) => {
            if (a.event_date < b.event_date) return -1;
            if (a.event_date > b.event_date) return 1;
            if ((a.event_time || '') < (b.event_time || '')) return -1;
            return 1;
        });

        res.json(combined);
    } catch (error) {
        console.error('Errore recupero eventi:', error);
        res.status(500).json({ error: 'Errore recupero eventi.' });
    }
});

/**
 * POST /api/events
 * - Evento Ufficio: solo capo / admin
 * - Evento Personale: solo il proprietario del calendario
 */
app.post('/api/events', authenticateToken, async (req, res) => {
    try {
        const { calendar_id, title, event_date, event_time, event_end_time, description } = req.body;
        if (!calendar_id || !title || !event_date)
            return res.status(400).json({ error: 'Calendario, titolo e data sono obbligatori.' });

        const [calRows] = await pool.execute('SELECT * FROM calendars WHERE id = ?', [calendar_id]);
        const calendar = calRows[0];
        if (!calendar) return res.status(404).json({ error: 'Calendario non trovato.' });

        if (calendar.is_global) {
            if (!['capo', 'admin'].includes(req.user.role))
                return res.status(403).json({
                    error: 'Solo i Capo e gli Admin possono aggiungere eventi al calendario Ufficio.'
                });
        } else {
            if (calendar.user_id !== req.user.id)
                return res.status(403).json({ error: 'Non puoi aggiungere eventi al calendario di un altro utente.' });
        }

        // Controllo sovrapposizione cross-calendar
        if (event_time && event_end_time) {
            if (event_time >= event_end_time)
                return res.status(400).json({ error: 'L\'ora di fine deve essere successiva all\'ora di inizio.' });

            const [overlapping] = await pool.execute(
                `SELECT e.title, e.event_time, e.event_end_time, c.type AS calendar_type
                 FROM events e JOIN calendars c ON e.calendar_id = c.id
                 WHERE (c.user_id = ? OR c.is_global = TRUE)
                   AND e.event_date = ?
                   AND e.event_time IS NOT NULL AND e.event_end_time IS NOT NULL
                   AND ? < e.event_end_time AND ? > e.event_time`,
                [req.user.id, event_date, event_time, event_end_time]
            );
            if (overlapping.length > 0) {
                const c = overlapping[0];
                return res.status(400).json({
                    error: `Conflitto orario: si sovrappone con "${c.title}" (${c.event_time.substring(0,5)}–${c.event_end_time.substring(0,5)}) nel calendario "${c.calendar_type}".`
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

/**
/**
 * PUT /api/events/:eventId
 * - Evento Ufficio: solo capo / admin
 * - Evento Personale: solo il proprietario
 */
app.put('/api/events/:eventId', authenticateToken, async (req, res) => {
    try {
        const { eventId } = req.params;
        const { title, event_date, event_time, event_end_time, description } = req.body;

        if (!title || !event_date)
            return res.status(400).json({ error: 'Titolo e data sono obbligatori.' });

        // Recupera evento + info calendario
        const [rows] = await pool.execute(
            `SELECT e.*, c.is_global, c.user_id AS cal_owner
             FROM events e JOIN calendars c ON e.calendar_id = c.id
             WHERE e.id = ?`,
            [eventId]
        );
        const event = rows[0];
        if (!event) return res.status(404).json({ error: 'Evento non trovato.' });

        // Controllo permessi
        if (event.is_global) {
            if (!['capo', 'admin'].includes(req.user.role))
                return res.status(403).json({ error: 'Solo i Capo e gli Admin possono modificare eventi Ufficio.' });
        } else {
            if (event.cal_owner !== req.user.id)
                return res.status(403).json({ error: 'Non puoi modificare eventi di un altro utente.' });
        }

        // Controllo sovrapposizione (esclude l'evento stesso)
        if (event_time && event_end_time) {
            if (event_time >= event_end_time)
                return res.status(400).json({ error: "L'ora di fine deve essere successiva all'ora di inizio." });

            const [overlapping] = await pool.execute(
                `SELECT e.title, e.event_time, e.event_end_time, c.type AS calendar_type
                 FROM events e JOIN calendars c ON e.calendar_id = c.id
                 WHERE (c.user_id = ? OR c.is_global = TRUE)
                   AND e.event_date = ?
                   AND e.id != ?
                   AND e.event_time IS NOT NULL AND e.event_end_time IS NOT NULL
                   AND ? < e.event_end_time AND ? > e.event_time`,
                [req.user.id, event_date, eventId, event_time, event_end_time]
            );
            if (overlapping.length > 0) {
                const c = overlapping[0];
                return res.status(400).json({
                    error: `Conflitto orario: si sovrappone con "${c.title}" (${c.event_time.substring(0,5)}–${c.event_end_time.substring(0,5)}) nel calendario "${c.calendar_type}".`
                });
            }
        }

        await pool.execute(
            `UPDATE events
             SET title = ?, event_date = ?, event_time = ?, event_end_time = ?, description = ?
             WHERE id = ?`,
            [title, event_date, event_time || null, event_end_time || null, description || '', eventId]
        );
        res.json({ message: 'Evento aggiornato con successo.' });
    } catch (error) {
        console.error('Errore modifica evento:', error);
        res.status(500).json({ error: "Errore interno durante la modifica dell'evento." });
    }
});

/** DELETE /api/events/:eventId
 * - Evento Ufficio: solo capo / admin
 * - Evento Personale: solo il proprietario
 */
app.delete('/api/events/:eventId', authenticateToken, async (req, res) => {
    try {
        const { eventId } = req.params;
        const [rows] = await pool.execute(
            `SELECT e.*, c.is_global, c.user_id AS cal_owner
             FROM events e JOIN calendars c ON e.calendar_id = c.id
             WHERE e.id = ?`,
            [eventId]
        );
        const event = rows[0];
        if (!event) return res.status(404).json({ error: 'Evento non trovato.' });

        if (event.is_global) {
            if (!['capo', 'admin'].includes(req.user.role))
                return res.status(403).json({ error: 'Solo i Capo e gli Admin possono eliminare eventi Ufficio.' });
        } else {
            if (event.cal_owner !== req.user.id)
                return res.status(403).json({ error: 'Non puoi eliminare eventi di un altro utente.' });
        }

        await pool.execute('DELETE FROM events WHERE id = ?', [eventId]);
        res.json({ message: 'Evento eliminato.' });
    } catch (error) {
        console.error('Errore eliminazione evento:', error);
        res.status(500).json({ error: 'Errore interno durante l\'eliminazione dell\'evento.' });
    }
});

// ============================================================
// ADMIN ROUTES — solo ruolo 'admin'
// ============================================================

app.get('/api/admin/users', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT id, username, email, role, created_at FROM users ORDER BY created_at ASC'
        );
        res.json(rows);
    } catch (error) {
        console.error('Errore lista utenti:', error);
        res.status(500).json({ error: 'Errore recupero lista utenti.' });
    }
});

app.put('/api/admin/users/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);
        const { role } = req.body;

        if (!['user', 'capo'].includes(role))
            return res.status(400).json({ error: 'Ruolo non valido. Usa "user" o "capo".' });
        if (targetId === req.user.id)
            return res.status(400).json({ error: 'Non puoi modificare il tuo stesso ruolo.' });

        const [rows] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [targetId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Utente non trovato.' });
        if (rows[0].role === 'admin')
            return res.status(403).json({ error: 'Non puoi modificare il ruolo di un altro admin.' });

        await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, targetId]);
        res.json({ message: `Ruolo aggiornato a "${role}".` });
    } catch (error) {
        console.error('Errore cambio ruolo:', error);
        res.status(500).json({ error: 'Errore interno durante il cambio ruolo.' });
    }
});

// ============================================================
// PADRE PIO
// ============================================================
app.get('/api/padrepio/thought/:date', authenticateToken, (req, res) => {
    if (padrePioQuotes.length === 0)
        return res.status(503).json({ error: 'Citazioni non disponibili.' });
    const dateStr = req.params.date;
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
    res.json({ date: dateStr, thought: padrePioQuotes[Math.abs(hash) % padrePioQuotes.length] });
});

// ============================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server pronto sulla porta ${PORT}`));