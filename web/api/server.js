require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');
const fs = require('fs');
const path = require('path');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Helper to save Base64 image and return URL/filename
const saveBase64 = (base64Str, prefix = 'img') => {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return base64Str; // Return as is if not base64
    }
    try {
        const matches = base64Str.match(/^data:image\/([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return base64Str;

        const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
        const filepath = path.join(uploadsDir, filename);

        fs.writeFileSync(filepath, buffer);
        return `/uploads/${filename}`;
    } catch (e) {
        console.error('Error saving base64 image:', e);
        return base64Str;
    }
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1 + 1 AS result');
        res.json({ success: true, message: 'La conexión a MySQL es exitosa', data: rows });
    } catch (error) {
        console.error('Error in /api/test-db:', error);
        res.status(500).json({ success: false, message: 'Fallo al conectar a MySQL', error: error.message });
    }
});

// Inicializar la base de datos con tablas para todos los datos
app.get('/api/init', async (req, res) => {
    try {
        await initDB();
        res.json({ success: true, message: 'Base de datos inicializada correctamente con datos semilla.' });
    } catch (error) {
        console.error('Error inicializando DB via API:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---- RUTAS PARA USERS ----
app.get('/api/users', async (req, res) => {
    try {
        const [users] = await db.query('SELECT * FROM users WHERE status != "eliminado" ORDER BY id DESC');
        res.json({ success: true, data: users });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/users', async (req, res) => {
    try {
        const { name, password, role, email, createdAt, createdBy, status, modifiedBy, modifiedAt } = req.body;
        const [result] = await db.query('INSERT INTO users (name, password, role, email, createdAt, createdBy, status, modifiedBy, modifiedAt) VALUES (?,?,?,?,?,?,?,?,?)',
            [name, password, role, email, createdAt, createdBy, status, modifiedBy, modifiedAt]);
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.put('/api/users/:id', async (req, res) => {
    try {
        const { name, role, email, status, modifiedBy, modifiedAt } = req.body;
        await db.query('UPDATE users SET name=?, role=?, email=?, status=?, modifiedBy=?, modifiedAt=? WHERE id=?',
            [name, role, email, status, modifiedBy, modifiedAt, req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.delete('/api/users/:id', async (req, res) => {
    try {
        const { deletedBy, deletedAt } = req.body || {};
        await db.query('UPDATE users SET status="eliminado", deletedBy=?, deletedAt=? WHERE id=?', [deletedBy || 'Sistema', deletedAt || new Date().toISOString(), req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA TASKS ----
app.get('/api/tasks', async (req, res) => {
    try {
        const [tasks] = await db.query('SELECT * FROM tasks WHERE status != "eliminado" ORDER BY id DESC');
        res.json({ success: true, data: tasks });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/tasks', async (req, res) => {
    try {
        const { client, transportista, bultos, guia, priority, date, sector, description, status, createdBy, createdAt } = req.body;
        const [result] = await db.query('INSERT INTO tasks (client, transportista, bultos, guia, priority, date, sector, description, status, createdBy, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [client, transportista, bultos, guia, priority, date, sector, description, status, createdBy || 'Sistema', createdAt || new Date().toISOString()]);

        // Auto-generate notification for high priority task
        if (priority === 'alta') {
            const [users] = await db.query('SELECT id FROM users WHERE name = ?', [transportista]);
            const targetIds = users.length > 0 ? [users[0].id] : [];
            const message = `🚨 Tarea de Alta Prioridad #${result.insertId}: "${description}" para ${client}. Sector: ${sector}`;
            const dateStr = new Date().toLocaleString('es-ES');
            await db.query('INSERT INTO notifications (type, message, from_user, targetUserIds, date, is_read) VALUES (?,?,?,?,?,?)',
                ['task', message, 'Sistema', JSON.stringify(targetIds), dateStr, 0]);
        }

        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const { status } = req.body;
        await db.query('UPDATE tasks SET status=? WHERE id=?', [status, req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { deletedBy, deletedAt, force } = req.body || {};
        if (force) {
            await db.query('DELETE FROM tasks WHERE id=?', [req.params.id]);
        } else {
            await db.query('UPDATE tasks SET status="eliminado", deletedBy=?, deletedAt=? WHERE id=?', [deletedBy || 'Sistema', deletedAt || new Date().toISOString(), req.params.id]);
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA COMPLETED TASKS ----
app.get('/api/completed-tasks', async (req, res) => {
    try {
        const [tasks] = await db.query('SELECT * FROM completed_tasks ORDER BY completedAt DESC');
        tasks.forEach(t => t.fotos = typeof t.fotos === 'string' ? JSON.parse(t.fotos) : t.fotos);
        res.json({ success: true, data: tasks });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/completed-tasks', async (req, res) => {
    try {
        const { id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos, completedAt, gps, responsable } = req.body;

        // Process images: save to files
        const savedFotos = (fotos || []).map((f, i) => saveBase64(f, `task_${id}_${i}`));
        const fotosJson = JSON.stringify(savedFotos);

        await db.query(`
            INSERT INTO completed_tasks 
            (id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos, completedAt, gps, responsable) 
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE 
            client=?, transportista=?, bultos=?, guia=?, priority=?, date=?, sector=?, description=?, status=?, observacion=?, placa=?, fotos=?, completedAt=?, gps=?, responsable=?
        `, [
            id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotosJson, completedAt, gps, responsable,
            client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotosJson, completedAt, gps, responsable
        ]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.put('/api/completed-tasks/:id', async (req, res) => {
    try {
        const { observacion, placa, status } = req.body;
        await db.query('UPDATE completed_tasks SET observacion=?, placa=?, status=? WHERE id=?',
            [observacion, placa, status, req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA MOVEMENTS ----
app.get('/api/movements', async (req, res) => {
    try {
        const [movements] = await db.query('SELECT * FROM movements ORDER BY id DESC');
        movements.forEach(m => m.fotos = typeof m.fotos === 'string' ? JSON.parse(m.fotos) : m.fotos);
        res.json({ success: true, data: movements });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/movements', async (req, res) => {
    try {
        const { tipo, notas, fotos, fecha, gps, transportista } = req.body;

        // Process images: save to files
        const savedFotos = (fotos || []).map((f, i) => saveBase64(f, `mov_${Date.now()}_${i}`));
        const fotosJson = JSON.stringify(savedFotos);

        const [result] = await db.query('INSERT INTO movements (tipo, notas, fotos, fecha, gps, transportista) VALUES (?,?,?,?,?,?)',
            [tipo, notas, fotosJson, fecha, gps, transportista]);
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA VEHICLES ----
app.get('/api/vehicles', async (req, res) => {
    try {
        const [vehicles] = await db.query('SELECT * FROM vehicles WHERE status != "eliminado" ORDER BY id DESC');
        res.json({ success: true, data: vehicles });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/vehicles', async (req, res) => {
    try {
        const { modelo, placa, foto, status } = req.body;
        const [result] = await db.query('INSERT INTO vehicles (modelo, placa, foto, status) VALUES (?,?,?,?)',
            [modelo, placa, foto, status]);
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.put('/api/vehicles/:id', async (req, res) => {
    try {
        const { modelo, placa, status } = req.body;
        await db.query('UPDATE vehicles SET modelo=?, placa=?, status=? WHERE id=?',
            [modelo, placa, status, req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.delete('/api/vehicles/:id', async (req, res) => {
    try {
        const { deletedBy, deletedAt } = req.body || {};
        await db.query('UPDATE vehicles SET status="eliminado", deletedBy=?, deletedAt=? WHERE id=?', [deletedBy || 'Sistema', deletedAt || new Date().toISOString(), req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA NOTIFICATIONS ----
app.get('/api/notifications', async (req, res) => {
    try {
        const [notifications] = await db.query('SELECT * FROM notifications ORDER BY id DESC');
        notifications.forEach(n => {
            n.targetUserIds = typeof n.targetUserIds === 'string' ? JSON.parse(n.targetUserIds) : n.targetUserIds;
            n.read = n.is_read == 1;
        });
        res.json({ success: true, data: notifications });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.post('/api/notifications', async (req, res) => {
    try {
        const { type, message, from_user, targetUserIds, date, read } = req.body;
        const targetsJson = JSON.stringify(targetUserIds || []);
        const [result] = await db.query('INSERT INTO notifications (type, message, from_user, targetUserIds, date, is_read) VALUES (?,?,?,?,?,?)',
            [type, message, from_user, targetsJson, date, read ? 1 : 0]);
        res.json({ success: true, id: result.insertId });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.put('/api/notifications/read/:id', async (req, res) => {
    try {
        await db.query('UPDATE notifications SET is_read=1 WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});
app.put('/api/notifications/read-all', async (req, res) => {
    try {
        const { targetUserIds } = req.body;
        // simplistic approach: mark all read
        await db.query('UPDATE notifications SET is_read=1');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA GPS TRACKING ----
// In-memory store for real-time driver locations to avoid DB overload
const driverLocations = {};

app.post('/api/gps', async (req, res) => {
    try {
        const { driverId, driverName, lat, lng } = req.body;
        const now = Date.now();
        console.log(`📍 GPS Update from ${driverName}: ${lat}, ${lng}`);

        // Save to in-memory for fast polling
        driverLocations[driverName] = {
            driverId,
            name: driverName,
            lat,
            lng,
            timestamp: now,
            lastUpdate: new Date().toLocaleTimeString(),
            online: true
        };

        // Persist to database
        await db.query(
            'INSERT INTO vehicle_locations (driverId, driverName, lat, lng, last_timestamp, online) VALUES (?, ?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE lat=?, lng=?, last_timestamp=?, online=1',
            [driverId, driverName, lat, lng, now, lat, lng, now]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('GPS Save Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/gps', async (req, res) => {
    try {
        const now = Date.now();
        // Sync memory with DB occasionally or just use DB
        const [rows] = await db.query('SELECT * FROM vehicle_locations');
        const dbLocations = {};
        rows.forEach(r => {
            const lastTs = r.last_timestamp || 0;
            const isOnline = (now - lastTs < 90000); // 90 seconds threshold (30s interval * 3)
            dbLocations[r.driverName] = {
                driverId: r.driverId,
                name: r.driverName,
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lng),
                timestamp: lastTs,
                lastUpdate: lastTs ? new Date(lastTs).toLocaleTimeString() : 'N/A',
                online: !!isOnline
            };
        });
        // Merge with memory to be safe
        const combined = { ...driverLocations, ...dbLocations };
        res.json({ success: true, data: combined });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

(async () => {
    try {
        console.log('📦 Inicializando base de datos...');
        await initDB();

        const PORT = process.env.PORT || 5000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor backend corriendo en http://0.0.0.0:${PORT}`);
            console.log('✅ Base de datos lista y servidor activo.');
        });
    } catch (e) {
        console.error('❌ Error crítico al iniciar servidor:', e);
        process.exit(1);
    }
})();


// Rename existing function or extract logic for auto-init
async function initDB() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            createdAt VARCHAR(50),
            createdBy VARCHAR(100),
            status VARCHAR(50),
            modifiedBy VARCHAR(100),
            modifiedAt VARCHAR(50)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INT AUTO_INCREMENT PRIMARY KEY,
            client VARCHAR(255),
            transportista VARCHAR(255),
            bultos INT,
            guia VARCHAR(100),
            priority VARCHAR(50),
            date VARCHAR(50),
            sector VARCHAR(100),
            description TEXT,
            status VARCHAR(50),
            createdBy VARCHAR(255),
            createdAt VARCHAR(50),
            deletedBy VARCHAR(100),
            deletedAt VARCHAR(50)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS completed_tasks (
            id INT PRIMARY KEY,
            client VARCHAR(255),
            transportista VARCHAR(255),
            bultos INT,
            guia VARCHAR(100),
            priority VARCHAR(50),
            date VARCHAR(50),
            sector VARCHAR(100),
            description TEXT,
            status VARCHAR(50),
            observacion TEXT,
            placa VARCHAR(50),
            fotos JSON,
            completedAt VARCHAR(50),
            gps VARCHAR(100),
            responsable VARCHAR(100)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS vehicle_locations (
            driverId INT PRIMARY KEY,
            driverName VARCHAR(255),
            lat DECIMAL(15, 12),
            lng DECIMAL(15, 12),
            last_timestamp BIGINT,
            online TINYINT(1) DEFAULT 1
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            modelo VARCHAR(100),
            placa VARCHAR(50),
            foto TEXT,
            status VARCHAR(50),
            deletedBy VARCHAR(100),
            deletedAt VARCHAR(50)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS movements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tipo VARCHAR(50),
            notas TEXT,
            fotos JSON,
            fecha VARCHAR(50),
            gps VARCHAR(100),
            transportista VARCHAR(255)
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(50),
            message TEXT,
            from_user VARCHAR(100),
            targetUserIds JSON,
            date VARCHAR(50),
            is_read BOOLEAN DEFAULT FALSE
        )
    `);
    // Safety checks for existing tables
    const tablesToAlter = [
        { table: 'tasks', column: 'createdBy', type: 'VARCHAR(255)' },
        { table: 'tasks', column: 'createdAt', type: 'VARCHAR(50)' },
        { table: 'tasks', column: 'deletedBy', type: 'VARCHAR(100)' },
        { table: 'tasks', column: 'deletedAt', type: 'VARCHAR(50)' },
        { table: 'vehicles', column: 'deletedBy', type: 'VARCHAR(100)' },
        { table: 'vehicles', column: 'deletedAt', type: 'VARCHAR(50)' },
        { table: 'users', column: 'deletedBy', type: 'VARCHAR(100)' },
        { table: 'users', column: 'deletedAt', type: 'VARCHAR(50)' },
        { table: 'vehicle_locations', column: 'last_timestamp', type: 'BIGINT' }
    ];

    for (const item of tablesToAlter) {
        try {
            const [cols] = await db.query(`SHOW COLUMNS FROM ${item.table} LIKE '${item.column}'`);
            if (cols.length === 0) {
                await db.query(`ALTER TABLE ${item.table} ADD COLUMN ${item.column} ${item.type}`);
                console.log(`✅ Added column ${item.column} to ${item.table}`);
            }
        } catch (e) {
            console.warn(`⚠️ Error checking/adding column ${item.column} in ${item.table}:`, e.message);
        }
    }

    // Fix lat/lng precision if needed
    try {
        await db.query('ALTER TABLE vehicle_locations MODIFY COLUMN lat DECIMAL(15,12), MODIFY COLUMN lng DECIMAL(15,12)');
    } catch (e) { }

    // Seed initial users
    /* const [uCount] = await db.query('SELECT COUNT(*) as cnt FROM users');
     if (uCount[0].cnt === 0) {
         await db.query(`
             INSERT INTO users(name, password, role, email, createdAt, createdBy, status) VALUES
             ('Juan Pérez', 'admin123', 'Administrador', 'juan.perez@conedera.com', '19/02/2026', 'Sistema', 'activo'),
             ('Carlos Rodríguez', '1234', 'Conductor', 'carlos.r@conedera.com', '15/02/2026', 'Juan Pérez', 'activo'),
             ('WASHINGTON VILLAMAR', '123456', 'Administrador', 'wvillamar@conedera.com', '19/02/2026', 'Sistema', 'activo')
         `);
     }
 
     // Seed initial tasks
     const [tCount] = await db.query('SELECT COUNT(*) as cnt FROM tasks');
     if (tCount[0].cnt === 0) {
         await db.query(`
             INSERT INTO tasks(client, transportista, bultos, guia, priority, date, sector, description, status) VALUES
             ('Empresa Tech Solutions', 'Carlos Rodríguez', 5, 'GU-20260219-001', 'alta', '2026-02-19', 'Centro', 'Entrega de equipos electrónicos.', 'activo'),
             ('Bufete Legal Asociados', 'Carlos Rodríguez', 2, 'GU-20260219-002', 'normal', '2026-02-19', 'Norte', 'Documentos legales.', 'activo')
         `);
     }*/

    // Seed initial vehicles
    const [vCount] = await db.query('SELECT COUNT(*) as cnt FROM vehicles');
    if (vCount[0].cnt === 0) {
        await db.query(`
            INSERT INTO vehicles(modelo, placa, foto, status) VALUES
            ('Toyota Hilux 2024', 'ABC-123', '', 'activo'),
            ('Hyundai H1 2023', 'XYZ-789', '', 'activo')
        `);
    }

    console.log("✅ Tablas y datos semilla verificados satisfactoriamente.");
}
