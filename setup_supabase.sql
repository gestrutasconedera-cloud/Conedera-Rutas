-- COPIE ESTE CÓDIGO Y PÉGUELO EN EL "SQL EDITOR" DE SUPABASE

-- 1. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'activo',
    "createdAt" TEXT,
    "createdBy" TEXT,
    "modifiedBy" TEXT,
    "modifiedAt" TEXT,
    "deletedBy" TEXT,
    "deletedAt" TEXT
);

-- 2. Tabla de Tareas
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    client TEXT,
    transportista TEXT,
    bultos INTEGER,
    guia TEXT,
    priority TEXT,
    date TEXT,
    sector TEXT,
    description TEXT,
    status TEXT DEFAULT 'activo',
    "createdBy" TEXT,
    "createdAt" TEXT,
    "deletedBy" TEXT,
    "deletedAt" TEXT
);

-- 3. Tabla de Tareas Completadas
CREATE TABLE IF NOT EXISTS completed_tasks (
    id INTEGER PRIMARY KEY,
    client TEXT,
    transportista TEXT,
    bultos INTEGER,
    guia TEXT,
    priority TEXT,
    date TEXT,
    sector TEXT,
    description TEXT,
    status TEXT,
    observacion TEXT,
    placa TEXT,
    fotos JSONB,
    "completedAt" TEXT,
    gps TEXT,
    responsable TEXT
);

-- 4. Tabla de Movimientos (Almacén)
CREATE TABLE IF NOT EXISTS movements (
    id SERIAL PRIMARY KEY,
    tipo TEXT,
    notas TEXT,
    fotos JSONB,
    fecha TEXT,
    gps TEXT,
    transportista TEXT
);

-- 5. Tabla de Vehículos
CREATE TABLE IF NOT EXISTS vehicles (
    id SERIAL PRIMARY KEY,
    modelo TEXT,
    placa TEXT,
    foto TEXT,
    status TEXT DEFAULT 'activo',
    "deletedBy" TEXT,
    "deletedAt" TEXT
);

-- 6. Tabla de Notificaciones
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    type TEXT,
    message TEXT,
    from_user TEXT,
    "targetUserIds" JSONB,
    date TEXT,
    is_read BOOLEAN DEFAULT FALSE
);

-- 7. Tabla de Ubicaciones (GPS)
CREATE TABLE IF NOT EXISTS vehicle_locations (
    "driverId" INTEGER PRIMARY KEY,
    "driverName" TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    last_timestamp BIGINT,
    online BOOLEAN DEFAULT TRUE
);

-- 8. Tabla de Permisos por Rol/Usuario
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    menu_option TEXT NOT NULL,
    can_view BOOLEAN DEFAULT FALSE,
    can_create BOOLEAN DEFAULT FALSE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    UNIQUE(user_id, menu_option)
);

-- 9. Tabla para Tokens de Notificaciones Push
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    push_token TEXT NOT NULL,
    device_type TEXT, -- 'ios', 'android', 'web'
    UNIQUE(user_id, push_token)
);

-- DATOS INICIALES (OPCIONAL)
INSERT INTO users (name, password, role, email, status) 
VALUES ('Administrador', 'admin123', 'Administrador', 'admin@conedera.com', 'activo')
ON CONFLICT (email) DO NOTHING;
