<<<<<<< HEAD
-- =============================================================================
-- SCRIPT COMPLETO DE CONFIGURACIÓN POSTGRES / SUPABASE - CONEDERA RUTAS
-- =============================================================================
-- Este script crea todas las tablas, índices, restricciones y datos iniciales (seed)
-- necesarios para el funcionamiento de la plataforma Conedera Rutas.

-- Opcional: Crear y conectar a la base de datos (descomentar si se ejecuta localmente)
-- CREATE DATABASE conedera_rutas;
-- \c conedera_rutas;

-- Habilitar extensión para UUID si fuera necesario en el futuro
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. TABLA DE USUARIOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Administrador', 'Supervisor', 'Conductor', 'Almacenero')),
    email TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo', 'eliminado')),
    "createdAt" TEXT,
    "createdBy" TEXT,
    "modifiedBy" TEXT,
    "modifiedAt" TEXT,
    "deletedBy" TEXT,
    "deletedAt" TEXT
);

-- =============================================================================
-- 2. TABLA DE TAREAS (PENDIENTES/ACTIVAS)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    client TEXT NOT NULL,
    transportista TEXT DEFAULT 'Sin asignar',
    bultos INTEGER DEFAULT 1,
    guia TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'alta')),
    date TEXT, -- Formato YYYY-MM-DD
    sector TEXT,
    description TEXT,
    status TEXT DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo', 'eliminado')),
    "createdBy" TEXT,
    "createdAt" TEXT,
    "deletedBy" TEXT,
    "deletedAt" TEXT
);

-- =============================================================================
-- 3. TABLA DE TAREAS COMPLETADAS (HISTORIAL)
-- =============================================================================
CREATE TABLE IF NOT EXISTS completed_tasks (
    id INTEGER PRIMARY KEY, -- Mapeado directamente con el ID de la tarea origen
    client TEXT,
    transportista TEXT,
    bultos INTEGER,
    guia TEXT,
    priority TEXT,
    date TEXT,
    sector TEXT,
    description TEXT,
    status TEXT DEFAULT 'Completado',
    observacion TEXT,
    placa TEXT,
    fotos JSONB DEFAULT '[]'::jsonb,
    "completedAt" TEXT,
    gps TEXT,
    responsable TEXT
);

-- =============================================================================
-- 4. TABLA DE MOVIMIENTOS (ALMACÉN - ENTRADAS / SALIDAS)
-- =============================================================================
CREATE TABLE IF NOT EXISTS movements (
    id SERIAL PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'salida')),
    notas TEXT,
    fotos JSONB DEFAULT '[]'::jsonb,
    fecha TEXT,
    gps TEXT,
    transportista TEXT
);

-- =============================================================================
-- 5. TABLA DE VEHÍCULOS
-- =============================================================================
CREATE TABLE IF NOT EXISTS vehicles (
    id SERIAL PRIMARY KEY,
    modelo TEXT NOT NULL,
    placa TEXT NOT NULL UNIQUE,
    foto TEXT,
    status TEXT DEFAULT 'activo' CHECK (status IN ('activo', 'inactivo', 'eliminado')),
    "deletedBy" TEXT,
    "deletedAt" TEXT
);

-- =============================================================================
-- 6. TABLA DE NOTIFICACIONES
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    type TEXT,
    message TEXT,
    from_user TEXT,
    "targetUserIds" JSONB DEFAULT '[]'::jsonb, -- Array de IDs de usuarios destino
    date TEXT,
    is_read BOOLEAN DEFAULT FALSE
);

-- =============================================================================
-- 7. TABLA DE UBICACIONES (GPS EN TIEMPO REAL DE VEHÍCULOS)
-- =============================================================================
CREATE TABLE IF NOT EXISTS vehicle_locations (
    "driverId" INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    "driverName" TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    last_timestamp BIGINT,
    online BOOLEAN DEFAULT TRUE
);

-- =============================================================================
-- 8. TABLA DE PERMISOS POR ROL / USUARIO
-- =============================================================================
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

-- =============================================================================
-- 9. TABLA PARA TOKENS DE NOTIFICACIONES PUSH
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    push_token TEXT NOT NULL,
    device_type TEXT CHECK (device_type IN ('ios', 'android', 'web')),
    UNIQUE(user_id, push_token)
);

-- =============================================================================
-- CREACIÓN DE ÍNDICES PARA OPTIMIZACIÓN DE CONSULTAS
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_transportista ON tasks(transportista);
CREATE INDEX IF NOT EXISTS idx_completed_tasks_transportista ON completed_tasks(transportista);
CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON user_push_tokens(user_id);

-- =============================================================================
-- REGISTROS SEMILLA (SEED DATA)
-- =============================================================================

-- A. Insertar Usuarios de Prueba
-- Contraseña genérica para pruebas: 'admin123' y 'conductor123'
INSERT INTO users (id, name, password, role, email, status, "createdAt", "createdBy") VALUES
(1, 'Administrador Sistema', 'admin123', 'Administrador', 'admin@conedera.com', 'activo', '17/06/2026 09:00', 'Sistema'),
(2, 'Carlos Supervisor', 'admin123', 'Supervisor', 'carlos@conedera.com', 'activo', '17/06/2026 09:15', 'Administrador'),
(3, 'Juan Pérez Conductor', 'conductor123', 'Conductor', 'juan@conedera.com', 'activo', '17/06/2026 09:30', 'Administrador'),
(4, 'Pedro Gómez Conductor', 'conductor123', 'Conductor', 'pedro@conedera.com', 'activo', '17/06/2026 09:35', 'Administrador'),
(5, 'Luis Warehouse', 'admin123', 'Almacenero', 'luis@conedera.com', 'activo', '17/06/2026 09:40', 'Administrador')
ON CONFLICT (id) DO NOTHING;

-- Ajustar la secuencia de IDs de usuarios después de insertar manualmente
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE(MAX(id), 1)) FROM users;

-- B. Insertar Permisos de Prueba por Usuario
-- Administrador: Acceso total
INSERT INTO permissions (user_id, menu_option, can_view, can_create, can_edit, can_delete) VALUES
(1, 'pending', true, true, true, true),
(1, 'completed', true, true, true, true),
(1, 'warehouse', true, true, true, true),
(1, 'vehicles', true, true, true, true),
(1, 'monitoring', true, true, true, true),
(1, 'notifications', true, true, true, true),
(1, 'users', true, true, true, true)
ON CONFLICT (user_id, menu_option) DO NOTHING;

-- Supervisor: Permisos de lectura, creación y edición en casi todo, menos eliminar usuarios o modificar permisos críticos
INSERT INTO permissions (user_id, menu_option, can_view, can_create, can_edit, can_delete) VALUES
(2, 'pending', true, true, true, false),
(2, 'completed', true, false, true, false),
(2, 'warehouse', true, true, true, false),
(2, 'vehicles', true, true, true, false),
(2, 'monitoring', true, true, true, false),
(2, 'notifications', true, true, true, false),
(2, 'users', true, false, false, false)
ON CONFLICT (user_id, menu_option) DO NOTHING;

-- Conductor: Solo ve pendientes asignados, completa tareas, registra E/S y recibe notificaciones
INSERT INTO permissions (user_id, menu_option, can_view, can_create, can_edit, can_delete) VALUES
(3, 'pending', true, false, true, false), -- can_edit para poder completarla
(3, 'completed', true, false, false, false), -- ver su historial
(3, 'warehouse', true, true, false, false), -- reportar ingresos/salidas de ruta
(3, 'notifications', true, false, false, false)
ON CONFLICT (user_id, menu_option) DO NOTHING;

INSERT INTO permissions (user_id, menu_option, can_view, can_create, can_edit, can_delete) VALUES
(4, 'pending', true, false, true, false),
(4, 'completed', true, false, false, false),
(4, 'warehouse', true, true, false, false),
(4, 'notifications', true, false, false, false)
ON CONFLICT (user_id, menu_option) DO NOTHING;

-- Almacenero: Ve control de almacén e ingresa/despacha transportistas
INSERT INTO permissions (user_id, menu_option, can_view, can_create, can_edit, can_delete) VALUES
(5, 'warehouse', true, true, true, false),
(5, 'notifications', true, false, false, false)
ON CONFLICT (user_id, menu_option) DO NOTHING;

-- C. Insertar Vehículos de Prueba
INSERT INTO vehicles (id, modelo, placa, foto, status) VALUES
(1, 'Chevrolet D-Max 4x4', 'PBA-1234', 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&q=80&w=400', 'activo'),
(2, 'Hino Dutro 5 Ton', 'GCA-5678', 'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?auto=format&fit=crop&q=80&w=400', 'activo'),
(3, 'JAC 3.5 Ton', 'PDA-9012', 'https://images.unsplash.com/photo-1516576427047-b84cc7ac5ccb?auto=format&fit=crop&q=80&w=400', 'activo')
ON CONFLICT (placa) DO NOTHING;

SELECT setval(pg_get_serial_sequence('vehicles', 'id'), COALESCE(MAX(id), 1)) FROM vehicles;

-- D. Insertar Tareas Pendientes de Prueba
INSERT INTO tasks (id, client, transportista, bultos, guia, priority, date, sector, description, status, "createdBy", "createdAt") VALUES
(101, 'Importadora Ecuatoriana S.A.', 'Juan Pérez Conductor', 12, '001-002-00045612', 'alta', '2026-06-18', 'Sector Norte (Carcelén)', 'Entrega de material logístico pesado. Solicitar firma del jefe de bodega.', 'activo', 'Carlos Supervisor', '17/06/2026 10:00'),
(102, 'Corporación Favorita', 'Juan Pérez Conductor', 5, '002-005-00129481', 'normal', '2026-06-18', 'Sector Centro (Centro Histórico)', 'Entrega de suministros de oficina. Acceso por la calle Venezuela.', 'activo', 'Carlos Supervisor', '17/06/2026 10:10'),
(103, 'Farmacias SanaSana', 'Pedro Gómez Conductor', 8, '001-010-00839210', 'normal', '2026-06-18', 'Sector Sur (Quitumbe)', 'Cajas de medicamentos refrigerados. Cuidado con la temperatura.', 'activo', 'Administrador Sistema', '17/06/2026 10:20'),
(104, 'Distribuidora del Pacífico', 'Sin asignar', 25, '005-001-00029381', 'alta', '2026-06-19', 'Sector Valles (Cumbayá)', 'Despacho urgente de repuestos industriales.', 'activo', 'Carlos Supervisor', '17/06/2026 10:30')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('tasks', 'id'), COALESCE(MAX(id), 104)) FROM tasks;

-- E. Insertar Tareas Completadas (Historial)
INSERT INTO completed_tasks (id, client, transportista, bultos, guia, priority, date, sector, description, status, observacion, placa, fotos, "completedAt", gps, responsable) VALUES
(90, 'Almacenes Marriott', 'Juan Pérez Conductor', 3, '001-001-00092813', 'normal', '2026-06-17', 'La Carolina', 'Entrega de luminarias decorativas.', 'Completado', 'Entrega exitosa sin novedades. Recibió Recepcionista María Silva.', 'PBA-1234', '["https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=400"]'::jsonb, '17/06/2026 14:30', '-0.1822, -78.4839', 'Juan Pérez Conductor'),
(91, 'Constructor Vip Corp', 'Pedro Gómez Conductor', 15, '003-002-00038491', 'alta', '2026-06-17', 'Valles (Tumbaco)', 'Bolsas de cemento y herramientas.', 'Completado', 'Cliente solicitó dejar los bultos en la planta baja. Fotos tomadas.', 'GCA-5678', '["https://images.unsplash.com/photo-1590069261209-f8e9b8642343?auto=format&fit=crop&q=80&w=400"]'::jsonb, '17/06/2026 15:45', '-0.2131, -78.4025', 'Pedro Gómez Conductor')
ON CONFLICT (id) DO NOTHING;

-- F. Insertar Movimientos de Almacén de Prueba
INSERT INTO movements (id, tipo, notas, fotos, fecha, gps, transportista) VALUES
(1, 'ingreso', 'Ingreso de mercadería - Importación de Guayaquil (Contenedor 40 pies)', '[]'::jsonb, '17/06/2026 08:30', 'Registro rápido', 'Luis Warehouse'),
(2, 'salida', 'Carga de vehículo PBA-1234 para ruta norte asignada a Juan Pérez', '[]'::jsonb, '17/06/2026 09:45', '-0.1807, -78.4678', 'Luis Warehouse'),
(3, 'salida', 'Carga de vehículo GCA-5678 para ruta sur asignada a Pedro Gómez', '[]'::jsonb, '17/06/2026 09:50', '-0.1807, -78.4678', 'Luis Warehouse')
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('movements', 'id'), COALESCE(MAX(id), 1)) FROM movements;

-- G. Insertar Ubicaciones Activas (Simuladas en el centro de Quito, Ecuador)
INSERT INTO vehicle_locations ("driverId", "driverName", lat, lng, last_timestamp, online) VALUES
(3, 'Juan Pérez Conductor', -0.1807, -78.4678, 1781700000000, true),
(4, 'Pedro Gómez Conductor', -0.1983, -78.4901, 1781700000000, true)
ON CONFLICT ("driverId") DO NOTHING;

-- H. Insertar Notificaciones de Prueba
INSERT INTO notifications (id, type, message, from_user, "targetUserIds", date, is_read) VALUES
(1, 'info', 'Bienvenido a la nueva plataforma de Conedera Rutas.', 'Sistema', '[]'::jsonb, '17/06/2026 08:00', false),
(2, 'task', 'Nueva tarea de prioridad ALTA asignada en Sector Norte.', 'Carlos Supervisor', '[3]'::jsonb, '17/06/2026 10:05', false)
ON CONFLICT (id) DO NOTHING;

SELECT setval(pg_get_serial_sequence('notifications', 'id'), COALESCE(MAX(id), 1)) FROM notifications;
=======
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
>>>>>>> 4d2301ed1f859106948feb68c62bf985d0f8d5aa
