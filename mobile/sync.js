const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const wwwDir = path.join(__dirname, 'www');

// Ensure www exists
if (!fs.existsSync(wwwDir)) {
    fs.mkdirSync(wwwDir);
}

const filesToCopy = [
    'index.html',
    'style.css',
    'script.js'
];

filesToCopy.forEach(file => {
    const src = path.join(rootDir, file);
    const dest = path.join(wwwDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to www/`);
    } else {
        console.warn(`File ${file} not found!`);
    }
});

console.log('Sync complete. You can now run "npx cap sync"');
