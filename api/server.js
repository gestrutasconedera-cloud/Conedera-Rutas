require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./database'); // Pool de conexión a PostgreSQL
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'conedera_super_secret_key_2026';

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
        return res.status(401).json({ success: false, error: 'Acceso denegado. Token no proporcionado.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Token inválido o expirado.' });
        }
        req.user = user;
        next();
    });
};

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Helper to save Base64 image and return URL/filename
const saveBase64 = (base64Str, prefix = 'img') => {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return base64Str;
    }
    try {
        const matches = base64Str.match(/^data:image\/([A-Za-z0-9-+]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return base64Str;

        const mimeType = matches[1].toLowerCase();
        let extension = '';
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
            extension = 'jpg';
        } else if (mimeType.includes('png')) {
            extension = 'png';
        } else if (mimeType.includes('gif')) {
            extension = 'gif';
        } else if (mimeType.includes('webp')) {
            extension = 'webp';
        } else {
            return base64Str;
        }

        const data = matches[2];
        const buffer = Buffer.from(data, 'base64');
        const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
        const filepath = path.join(uploadsDir, filename);

        const relative = path.relative(uploadsDir, filepath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('Intento de Path Traversal detectado.');
        }

        fs.writeFileSync(filepath, buffer);
        return `/uploads/${filename}`;
    } catch (e) {
        console.error('Error saving base64 image:', e);
        return base64Str;
    }
};

const app = express();
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use('/uploads', express.static(uploadsDir));

// TEST API
app.get('/api/test-db', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM users');
        res.json({ success: true, message: 'Conexión a PostgreSQL exitosa', count: parseInt(result.rows[0].count) });
    } catch (error) {
        console.error('Error testing PostgreSQL:', error);
        res.status(500).json({ success: false, message: 'Fallo al conectar a PostgreSQL' });
    }
});

// ---- RUTA DE LOGIN (PÚBLICA) ----
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Correo y contraseña son requeridos.' });
        }

        const emailLower = email.trim().toLowerCase();
        const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 AND status <> \'eliminado\'', [emailLower]);
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
        }

        const user = result.rows[0];

        if (user.status !== 'activo') {
            return res.status(401).json({ success: false, error: 'El usuario no está activo.' });
        }

        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, user.password);
        } catch (e) {
            isMatch = false;
        }

        // Fallback: si no coincide con bcrypt, verificar en texto plano
        if (!isMatch && password === user.password) {
            isMatch = true;
            // Migrar la contraseña a hash de bcrypt de forma transparente
            try {
                const hashedPassword = await bcrypt.hash(password, 10);
                await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
                console.log(`🔒 Contraseña del usuario ${emailLower} migrada a hash de bcrypt.`);
            } catch (hashError) {
                console.error('Error migrando contraseña a hash:', hashError);
            }
        }

        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Usuario o contraseña incorrectos.' });
        }

        // Obtener permisos del usuario
        const pRes = await pool.query('SELECT * FROM permissions WHERE user_id = $1', [user.id]);
        const permissions = pRes.rows;

        // Generar token JWT
        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                email: user.email,
                status: user.status,
                permissions
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA USERS ----
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, role, email, status, "createdAt", "createdBy", "modifiedBy", "modifiedAt" FROM users WHERE status <> \'eliminado\' ORDER BY id DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener usuarios:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/users', authenticateToken, async (req, res) => {
    try {
        const { name, password, role, email, status, createdAt, createdBy } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, error: 'La contraseña es requerida.' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (name, password, role, email, status, "createdAt", "createdBy") VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [name, hashedPassword, role, email, status || 'activo', createdAt, createdBy]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        console.error('Error al crear usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.put('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const { name, role, email, password, status, modifiedBy, modifiedAt } = req.body;
        
        if (password && password.trim()) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE users SET name = $1, role = $2, email = $3, password = $4, status = $5, "modifiedBy" = $6, "modifiedAt" = $7 WHERE id = $8',
                [name, role, email, hashedPassword, status, modifiedBy, modifiedAt, req.params.id]
            );
        } else {
            await pool.query(
                'UPDATE users SET name = $1, role = $2, email = $3, status = $4, "modifiedBy" = $5, "modifiedAt" = $6 WHERE id = $7',
                [name, role, email, status, modifiedBy, modifiedAt, req.params.id]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    try {
        const { deletedBy, deletedAt } = req.body || {};
        await pool.query(
            'UPDATE users SET status = \'eliminado\', "deletedBy" = $1, "deletedAt" = $2 WHERE id = $3',
            [deletedBy, deletedAt, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA TASKS ----
app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM tasks WHERE status <> 'eliminado' ORDER BY id DESC");
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener tareas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { client, transportista, bultos, guia, priority, date, sector, description, status, createdBy, createdAt } = req.body;
        const result = await pool.query(
            'INSERT INTO tasks (client, transportista, bultos, guia, priority, date, sector, description, status, "createdBy", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
            [client, transportista, bultos, guia, priority, date, sector, description, status || 'activo', createdBy, createdAt]
        );
        const taskId = result.rows[0].id;

        // Auto-generate notification for high priority task
        if (priority === 'alta') {
            const userListRes = await pool.query('SELECT id FROM users WHERE name = $1', [transportista]);
            const targetIds = userListRes.rows.map(u => u.id);
            const message = `🚨 Tarea de Alta Prioridad #${taskId}: "${description}" para ${client}. Sector: ${sector}`;
            const dateStr = new Date().toLocaleString('es-ES');
            
            await pool.query(
                'INSERT INTO notifications (type, message, from_user, "targetUserIds", date, is_read) VALUES ($1, $2, $3, $4, $5, false)',
                ['task', message, 'Sistema', JSON.stringify(targetIds), dateStr]
            );
            sendPushNotification(targetIds, message);
        }

        res.json({ success: true, id: taskId });
    } catch (error) {
        console.error('Error al crear tarea:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', [status, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error al actualizar tarea:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const { deletedBy, deletedAt, force } = req.body || {};
        if (force) {
            await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
        } else {
            await pool.query('UPDATE tasks SET status = \'eliminado\', "deletedBy" = $1, "deletedAt" = $2 WHERE id = $3', [deletedBy, deletedAt, req.params.id]);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar tarea:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA COMPLETED TASKS ----
app.get('/api/completed-tasks', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM completed_tasks ORDER BY "completedAt" DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener tareas completadas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/completed-tasks', authenticateToken, async (req, res) => {
    try {
        const { id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos, completedAt, gps, responsable } = req.body;

        const savedFotos = (fotos || []).map((f, i) => saveBase64(f, `task_${id}_${i}`));

        await pool.query(
            `INSERT INTO completed_tasks (id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos, "completedAt", gps, responsable)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (id) DO UPDATE SET
             client = EXCLUDED.client,
             transportista = EXCLUDED.transportista,
             bultos = EXCLUDED.bultos,
             guia = EXCLUDED.guia,
             priority = EXCLUDED.priority,
             date = EXCLUDED.date,
             sector = EXCLUDED.sector,
             description = EXCLUDED.description,
             status = EXCLUDED.status,
             observacion = EXCLUDED.observacion,
             placa = EXCLUDED.placa,
             fotos = EXCLUDED.fotos,
             "completedAt" = EXCLUDED."completedAt",
             gps = EXCLUDED.gps,
             responsable = EXCLUDED.responsable`,
            [id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, JSON.stringify(savedFotos), completedAt, gps, responsable]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar tarea completada:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA MOVEMENTS ----
app.get('/api/movements', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM movements ORDER BY id DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener movimientos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/movements', authenticateToken, async (req, res) => {
    try {
        const { tipo, notas, fotos, fecha, gps, transportista } = req.body;
        const savedFotos = (fotos || []).map((f, i) => saveBase64(f, `mov_${Date.now()}_${i}`));
        
        const result = await pool.query(
            'INSERT INTO movements (tipo, notas, fotos, fecha, gps, transportista) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [tipo, notas, JSON.stringify(savedFotos), fecha, gps, transportista]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        console.error('Error al registrar movimiento:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA VEHICLES ----
app.get('/api/vehicles', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM vehicles WHERE status <> 'eliminado' ORDER BY id DESC");
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener vehículos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/vehicles', authenticateToken, async (req, res) => {
    try {
        const { modelo, placa, foto, status } = req.body;
        const result = await pool.query(
            'INSERT INTO vehicles (modelo, placa, foto, status) VALUES ($1, $2, $3, $4) RETURNING id',
            [modelo, placa, foto, status || 'activo']
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        console.error('Error al crear vehículo:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.put('/api/vehicles/:id', authenticateToken, async (req, res) => {
    try {
        const { modelo, placa, status } = req.body;
        await pool.query(
            'UPDATE vehicles SET modelo = $1, placa = $2, status = $3 WHERE id = $4',
            [modelo, placa, status, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error al actualizar vehículo:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.delete('/api/vehicles/:id', authenticateToken, async (req, res) => {
    try {
        const { deletedBy, deletedAt } = req.body || {};
        await pool.query(
            'UPDATE vehicles SET status = \'eliminado\', "deletedBy" = $1, "deletedAt" = $2 WHERE id = $3',
            [deletedBy, deletedAt, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar vehículo:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA NOTIFICATIONS ----
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notifications ORDER BY id DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener notificaciones:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const { type, message, from_user, targetUserIds, date, is_read } = req.body;
        const result = await pool.query(
            'INSERT INTO notifications (type, message, from_user, "targetUserIds", date, is_read) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [type, message, from_user, JSON.stringify(targetUserIds || []), date, !!is_read]
        );

        // Trigger Push Notification
        sendPushNotification(targetUserIds, message);

        res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        console.error('Error al crear notificación:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// Helper for Push Notifications via Expo
const sendPushNotification = async (targetUserIds, messageBody) => {
    try {
        let targetTokens = [];
        if (!targetUserIds || targetUserIds.length === 0) {
            const res = await pool.query('SELECT push_token FROM user_push_tokens');
            targetTokens = res.rows.map(t => t.push_token);
        } else {
            const res = await pool.query('SELECT push_token FROM user_push_tokens WHERE user_id = ANY($1)', [targetUserIds]);
            targetTokens = res.rows.map(t => t.push_token);
        }

        if (targetTokens.length === 0) return;

        const messages = targetTokens.map(token => ({
            to: token,
            sound: 'default',
            body: messageBody,
            title: 'CONEDERA - Notificación'
        }));

        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });
        const result = await response.json();
        console.log('Expo Push Response:', result);
    } catch (e) {
        console.error('Error sending push notification:', e);
    }
};

app.put('/api/notifications/read/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error al marcar notificación como leída:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE is_read = false');
        res.json({ success: true });
    } catch (error) {
        console.error('Error al marcar todas las notificaciones como leídas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA GPS TRACKING ----
app.post('/api/gps', authenticateToken, async (req, res) => {
    try {
        const { driverId, driverName, lat, lng } = req.body;
        const now = Date.now();
        await pool.query(
            `INSERT INTO vehicle_locations ("driverId", "driverName", lat, lng, last_timestamp, online)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT ("driverId") DO UPDATE SET
             "driverName" = EXCLUDED."driverName",
             lat = EXCLUDED.lat,
             lng = EXCLUDED.lng,
             last_timestamp = EXCLUDED.last_timestamp,
             online = EXCLUDED.online`,
            [driverId, driverName, lat, lng, now]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('GPS Save Error:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.get('/api/gps', authenticateToken, async (req, res) => {
    try {
        const now = Date.now();
        const result = await pool.query('SELECT * FROM vehicle_locations');
        const data = result.rows;

        const mapped = {};
        data.forEach(r => {
            const lastTs = r.last_timestamp ? parseInt(r.last_timestamp) : 0;
            const isOnline = (now - lastTs < 90000);
            mapped[r.driverName] = { ...r, online: !!isOnline };
        });
        res.json({ success: true, data: mapped });
    } catch (error) {
        console.error('Error al obtener ubicaciones GPS:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA PERMISSIONS ----
app.get('/api/permissions/:userId', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM permissions WHERE user_id = $1', [req.params.userId]);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener permisos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

app.post('/api/permissions', authenticateToken, async (req, res) => {
    try {
        const { user_id, permissions } = req.body;
        for (const p of permissions) {
            await pool.query(
                `INSERT INTO permissions (user_id, menu_option, can_view, can_create, can_edit, can_delete)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (user_id, menu_option) DO UPDATE SET
                 can_view = EXCLUDED.can_view,
                 can_create = EXCLUDED.can_create,
                 can_edit = EXCLUDED.can_edit,
                 can_delete = EXCLUDED.can_delete`,
                [user_id, p.menu_option, p.can_view, p.can_create, p.can_edit, p.can_delete]
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar permisos:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

// ---- RUTAS PARA PUSH TOKENS ----
app.post('/api/push-tokens', authenticateToken, async (req, res) => {
    try {
        const { user_id, token, device_type } = req.body;
        await pool.query(
            `INSERT INTO user_push_tokens (user_id, push_token, device_type)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, push_token) DO UPDATE SET
             device_type = EXCLUDED.device_type`,
            [user_id, token, device_type]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error al guardar token push:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor.' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PostgreSQL Powered Server running at http://0.0.0.0:${PORT}`);
});
