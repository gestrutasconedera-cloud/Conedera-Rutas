require('dotenv').config();
const { Pool } = require('pg');

// Configuración individual de host, usuario y clave para la conexión
const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'admin123',
    database: process.env.DB_NAME || 'conedera_rutas',
    port: parseInt(process.env.DB_PORT || '5432'),
};

// Si se prefiere usar una URL de conexión única (DATABASE_URL), tiene prioridad
if (process.env.DATABASE_URL) {
    config.connectionString = process.env.DATABASE_URL;
}

// Configurar SSL automáticamente para servidores externos (no locales)
if (config.host !== 'localhost' && config.host !== '127.0.0.1' && !process.env.DISABLE_SSL) {
    config.ssl = {
        rejectUnauthorized: false
    };
}

const pool = new Pool(config);

pool.on('error', (err) => {
    console.error('❌ Error inesperado en el pool de clientes PostgreSQL:', err);
});

console.log(`🔌 Conexión configurada para base de datos PostgreSQL en host: ${config.host || 'DATABASE_URL'}`);

module.exports = pool;
