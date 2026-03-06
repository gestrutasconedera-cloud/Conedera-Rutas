# Guía de Despliegue - CONEDERA

Esta carpeta contiene todos los archivos necesarios para subir la plataforma a su dominio.

## Estructura de la Carpeta
- `index.html`, `style.css`, `script.js`: Archivos para el Dashboard de escritorio (sitio principal).
- `app/`: Versión Web Móvil para conductores (puede subirla a una subcarpeta como `/app`).
- `api/`: Backend en Node.js (necesita un servidor para ejecutarlo).

## Pasos para el Despliegue

### 1. Backend (API)
1. Suba el contenido de la carpeta `api/` a su servidor (VPS, cPanel con Node.js, etc.).
2. En la carpeta `api/`, renombre `.env.example` a `.env` y configure sus credenciales de base de datos MySQL.
3. Ejecute `npm install` para instalar las dependencias.
4. Inicie el servidor con `npm start` o `pm2 start server.js`.

### 2. Dashboard (Frontend Escritorio)
1. Suba `index.html`, `style.css` y `script.js` a la raíz de su dominio (ej: `www.sudominio.com`).
2. Abra `script.js` y verifique la variable `API_BASE` al inicio. Si su API está en otro subdominio, cambie `'/api'` por la URL completa (ej: `'https://api.sudominio.com/api'`).

### 3. Aplicación Móvil Web
1. Suba el contenido de la carpeta `app/` a una subcarpeta en su servidor (ej: `www.sudominio.com/app`).
2. Esto permitirá que los conductores entren desde sus teléfonos a esa dirección.

Si necesita ayuda adicional con la configuración del servidor, por favor consulte con su proveedor de hosting.
