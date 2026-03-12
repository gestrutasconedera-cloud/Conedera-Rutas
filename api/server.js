require('dotenv').config();
const express = require('express');
const cors = require('cors');
const supabase = require('./database');
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
        return base64Str;
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
app.use('/uploads', express.static(uploadsDir));

// TEST API
app.get('/api/test-db', async (req, res) => {
    try {
        const { data, error } = await supabase.from('users').select('count', { count: 'exact', head: true });
        if (error) throw error;
        res.json({ success: true, message: 'Conexión a Supabase exitosa', count: data });
    } catch (error) {
        console.error('Error testing Supabase:', error);
        res.status(500).json({ success: false, message: 'Fallo al conectar a Supabase', error: error.message });
    }
});

// ---- RUTAS PARA USERS ----
app.get('/api/users', async (req, res) => {
    try {
        const { data, error } = await supabase.from('users').select('*').neq('status', 'eliminado').order('id', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/users', async (req, res) => {
    try {
        const { name, password, role, email, status, createdAt, createdBy } = req.body;
        const { data, error } = await supabase.from('users').insert([{ name, password, role, email, status, createdAt, createdBy }]).select();
        if (error) throw error;
        res.json({ success: true, id: data[0].id });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const { name, role, email, status, modifiedBy, modifiedAt } = req.body;
        const { error } = await supabase.from('users').update({ name, role, email, status, modifiedBy, modifiedAt }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const { deletedBy, deletedAt } = req.body || {};
        const { error } = await supabase.from('users').update({ status: 'eliminado', deletedBy, deletedAt }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA TASKS ----
app.get('/api/tasks', async (req, res) => {
    try {
        const { data, error } = await supabase.from('tasks').select('*').neq('status', 'eliminado').order('id', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const { client, transportista, bultos, guia, priority, date, sector, description, status, createdBy, createdAt } = req.body;
        const { data, error } = await supabase.from('tasks').insert([{ client, transportista, bultos, guia, priority, date, sector, description, status, createdBy, createdAt }]).select();
        if (error) throw error;

        const taskId = data[0].id;

        // Auto-generate notification for high priority task
        if (priority === 'alta') {
            const { data: userList } = await supabase.from('users').select('id').eq('name', transportista);
            const targetIds = userList ? userList.map(u => u.id) : [];
            const message = `🚨 Tarea de Alta Prioridad #${taskId}: "${description}" para ${client}. Sector: ${sector}`;
            const dateStr = new Date().toLocaleString('es-ES');
            await supabase.from('notifications').insert([{ type: 'task', message, from_user: 'Sistema', targetUserIds: targetIds, date: dateStr, is_read: false }]);
            sendPushNotification(targetIds, message);
        }

        res.json({ success: true, id: taskId });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const { error } = await supabase.from('tasks').update({ status }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { deletedBy, deletedAt, force } = req.body || {};
        if (force) {
            const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('tasks').update({ status: 'eliminado', deletedBy, deletedAt }).eq('id', req.params.id);
            if (error) throw error;
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA COMPLETED TASKS ----
app.get('/api/completed-tasks', async (req, res) => {
    try {
        const { data, error } = await supabase.from('completed_tasks').select('*').order('completedAt', { ascending: false });
        if (error) throw error;
        // Fix JSON if stringified (Supabase handles JSON natively)
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/completed-tasks', async (req, res) => {
    try {
        const { id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos, completedAt, gps, responsable } = req.body;

        const savedFotos = (fotos || []).map((f, i) => saveBase64(f, `task_${id}_${i}`));

        const { error } = await supabase.from('completed_tasks').upsert([{
            id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos: savedFotos, completedAt, gps, responsable
        }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA MOVEMENTS ----
app.get('/api/movements', async (req, res) => {
    try {
        const { data, error } = await supabase.from('movements').select('*').order('id', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/movements', async (req, res) => {
    try {
        const { tipo, notas, fotos, fecha, gps, transportista } = req.body;
        const savedFotos = (fotos || []).map((f, i) => saveBase64(f, `mov_${Date.now()}_${i}`));
        const { data, error } = await supabase.from('movements').insert([{ tipo, notas, fotos: savedFotos, fecha, gps, transportista }]).select();
        if (error) throw error;
        res.json({ success: true, id: data[0].id });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA VEHICLES ----
app.get('/api/vehicles', async (req, res) => {
    try {
        const { data, error } = await supabase.from('vehicles').select('*').neq('status', 'eliminado').order('id', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/vehicles', async (req, res) => {
    try {
        const { modelo, placa, foto, status } = req.body;
        const { data, error } = await supabase.from('vehicles').insert([{ modelo, placa, foto, status }]).select();
        if (error) throw error;
        res.json({ success: true, id: data[0].id });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/vehicles/:id', async (req, res) => {
    try {
        const { modelo, placa, status } = req.body;
        const { error } = await supabase.from('vehicles').update({ modelo, placa, status }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/vehicles/:id', async (req, res) => {
    try {
        const { deletedBy, deletedAt } = req.body || {};
        const { error } = await supabase.from('vehicles').update({ status: 'eliminado', deletedBy, deletedAt }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA NOTIFICATIONS ----
app.get('/api/notifications', async (req, res) => {
    try {
        const { data, error } = await supabase.from('notifications').select('*').order('id', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/notifications', async (req, res) => {
    try {
        const { type, message, from_user, targetUserIds, date, is_read } = req.body;
        const { data, error } = await supabase.from('notifications').insert([{ type, message, from_user, targetUserIds, date, is_read: !!is_read }]).select();
        if (error) throw error;

        // Trigger Push Notification
        sendPushNotification(targetUserIds, message);

        res.json({ success: true, id: data[0].id });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// Helper for Push Notifications via Expo
const sendPushNotification = async (targetUserIds, messageBody) => {
    try {
        let targetTokens = [];
        if (!targetUserIds || targetUserIds.length === 0) {
            const { data } = await supabase.from('user_push_tokens').select('push_token');
            if (data) targetTokens = data.map(t => t.push_token);
        } else {
            const { data } = await supabase.from('user_push_tokens').select('push_token').in('user_id', targetUserIds);
            if (data) targetTokens = data.map(t => t.push_token);
        }

        if (targetTokens.length === 0) return;

        const messages = targetTokens.map(token => ({
            to: token,
            sound: 'default',
            body: messageBody,
            title: 'CONEDERA - Notificación'
        }));

        // Use dynamic import for node-fetch if needed, but modern Node has global fetch
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

app.put('/api/notifications/read/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/notifications/read-all', async (req, res) => {
    try {
        const { error } = await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA GPS TRACKING ----
app.post('/api/gps', async (req, res) => {
    try {
        const { driverId, driverName, lat, lng } = req.body;
        const now = Date.now();
        const { error } = await supabase.from('vehicle_locations').upsert([{
            driverId, driverName, lat, lng, last_timestamp: now, online: true
        }], { onConflict: 'driverId' });
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('GPS Save Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---- RUTAS PARA PERMISSIONS ----
app.get('/api/permissions/:userId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('permissions').select('*').eq('user_id', req.params.userId);
        if (error) throw error;
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/permissions', async (req, res) => {
    try {
        const { user_id, permissions } = req.body;
        // permissions should be an array of { menu_option, can_view, can_create, can_edit, can_delete }
        for (const p of permissions) {
            const { error } = await supabase.from('permissions').upsert({
                user_id,
                menu_option: p.menu_option,
                can_view: p.can_view,
                can_create: p.can_create,
                can_edit: p.can_edit,
                can_delete: p.can_delete
            }, { onConflict: 'user_id, menu_option' });
            if (error) throw error;
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ---- RUTAS PARA PUSH TOKENS ----
app.post('/api/push-tokens', async (req, res) => {
    try {
        const { user_id, token, device_type } = req.body;
        const { error } = await supabase.from('user_push_tokens').upsert({
            user_id,
            push_token: token,
            device_type
        }, { onConflict: 'user_id, push_token' });
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/gps', async (req, res) => {
    try {
        const now = Date.now();
        const { data, error } = await supabase.from('vehicle_locations').select('*');
        if (error) throw error;

        const mapped = {};
        data.forEach(r => {
            const lastTs = r.last_timestamp || 0;
            const isOnline = (now - lastTs < 90000);
            mapped[r.driverName] = { ...r, online: !!isOnline };
        });
        res.json({ success: true, data: mapped });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Supabase Powered Server running at http://0.0.0.0:${PORT}`);
});
