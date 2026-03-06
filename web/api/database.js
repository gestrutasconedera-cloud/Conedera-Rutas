require('dotenv').config();
const mysql = require('mysql2');

// Configuración de la conexión a la base de datos MySQL local
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Rutas2026*',
    database: process.env.DB_NAME || 'rutasco_db',
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
});

// Convertir a promesas para facilitar el uso con async/await
const promisePool = pool.promise();

// Validar la conexión
promisePool.getConnection()
    .then(connection => {
        console.log('✅ Conexión exitosa a la base de datos MySQL en localhost.');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Error conectando a la base de datos MySQL:', err.message);
    });

module.exports = promisePool;
