document.addEventListener('DOMContentLoaded', async () => {

    // =============================================
    // DATA STORE
    // =============================================
    // =============================================
    // CONFIGURACIÓN DE PRODUCCIÓN
    // =============================================
    // En producción, si el dashboard está en el mismo dominio que la API, use '/api'.
    // Si la API está en otro dominio, cambie '/api' por 'https://api.sudominio.com/api'.
    // Busca esta línea al principio de web/script.js y cámbiala:
const API_BASE = window.location.origin.includes'https://conedera-rutas.onrender.com/api'; // <--- Tu URL de Render


    const apiCall = (path, opts = {}) => fetch(API_BASE + path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts
    }).then(r => r.json()).catch(e => console.error('API Error:', e));

    const resolveImg = (src) => {
        if (!src) return '';
        if (src.startsWith('data:image') || src.startsWith('http')) return src;
        // If it starts with /uploads, prepend the base domain
        if (src.startsWith('/uploads')) {
            const domain = API_BASE.replace('/api', '');
            return domain + src;
        }
        return src;
    };

    let currentUser = null;

    let users = [];
    let tasks = [];
    let completedTasks = [];
    let movements = [];
    let vehicles = [];
    let notifications = [];

    // Driver GPS locations (simulated real-time)
    let driverLocations = {};
    let gpsTrackingInterval = null;
    let monitoringMap = null;
    let driverMarkers = {};
    let mapInitialized = false;

    async function initAppFromDB() {
        const fetchRes = async (path, setter) => {
            try {
                const res = await fetch(API_BASE + path);
                const data = await res.json();
                if (data.success && data.data) setter(data.data);
            } catch (e) {
                console.error('Error fetching ' + path, e);
            }
        };
        await Promise.all([
            fetchRes('/users', d => users = d),
            fetchRes('/tasks', d => tasks = d),
            fetchRes('/completed-tasks', d => completedTasks = d),
            fetchRes('/movements', d => movements = d),
            fetchRes('/vehicles', d => vehicles = d),
            fetchRes('/notifications', d => notifications = d)
        ]);
        console.log('✅ BD Sincronizada');
    }

    await initAppFromDB();


    // =============================================
    // UTILITIES
    // =============================================
    function formatDate(dateStr) {
        if (!dateStr || !dateStr.includes('-')) return dateStr;
        const p = dateStr.split('-');
        if (p.length !== 3) return dateStr;
        return `${p[2]}/${p[1]}/${p[0]}`;
    }
    function getTodayFormatted() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; }
    function getNowFormatted() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    function isAdmin() { return currentUser && (currentUser.role === 'Administrador' || currentUser.role === 'Supervisor'); }
    function isConductor() { return currentUser && currentUser.role === 'Conductor'; }

    function getGPS(el) {
        if (navigator.geolocation) {
            el.value = 'Obteniendo...';
            navigator.geolocation.getCurrentPosition(
                pos => { el.value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`; },
                () => { el.value = 'No disponible'; },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        } else { el.value = 'No soportado'; }
    }

    // =============================================
    // LOGIN SYSTEM
    // =============================================
    const loginScreen = document.getElementById('login-screen');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const appContainer = document.getElementById('app-container');

    loginForm.addEventListener('submit', e => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const pwd = document.getElementById('login-password').value;
        const user = users.find(u => u.email === email && u.password === pwd && u.status === 'activo');
        if (user) {
            currentUser = user;
            sessionStorage.setItem('loggedUserId', user.id);
            loginError.style.display = 'none';
            initApp();
        } else {
            loginError.style.display = 'flex';
            loginScreen.querySelector('.login-card').classList.add('shake');
            setTimeout(() => loginScreen.querySelector('.login-card').classList.remove('shake'), 600);
        }
    });

    // Auto-login from session
    const savedId = sessionStorage.getItem('loggedUserId');
    if (savedId) {
        const u = users.find(u => u.id === parseInt(savedId));
        if (u && u.status === 'activo') { currentUser = u; initApp(); }
    }

    function initApp() {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        setupRoleUI();
        renderTasks();
        renderCompletedTasks();
        renderMovements();
        renderUsers();
        renderVehicles();
        initNotifications();
        // Ask conductors for GPS permission
        if (isConductor()) requestDriverGPS();
        if (isConductor()) requestDriverGPS();
        // Constant sync for notifications and GPS
        setInterval(async () => {
            try {
                const [notifRes, gpsRes] = await Promise.all([
                    fetch(API_BASE + '/notifications'),
                    fetch(API_BASE + '/gps')
                ]);
                const notifData = await notifRes.json();
                const gpsData = await gpsRes.json();

                if (notifData.success) {
                    const oldMaxId = notifications.length > 0 ? Math.max(...notifications.map(n => n.id)) : 0;
                    const newNotifs = notifData.data;

                    // Check for new notifications targeted at the current user
                    const userNewNotifs = newNotifs.filter(n => {
                        const isNew = n.id > oldMaxId;
                        const isForMe = n.targetUserIds.length === 0 || n.targetUserIds.includes(currentUser.id);
                        return isNew && isForMe;
                    });

                    notifications = newNotifs;
                    updateNotifBadge();

                    if (userNewNotifs.length > 0) {
                        // Play sound or show alert
                        const lastOne = userNewNotifs[0];
                        alert(`🔔 NUEVA NOTIFICACIÓN:\nDe: ${lastOne.from}\n${lastOne.message}`);
                    }

                    if (document.getElementById('notif-dropdown').style.display !== 'none') {
                        renderNotifDropdown();
                    }
                    if (document.querySelector('[data-view="notifications"]').classList.contains('active')) {
                        renderNotificationsPage();
                    }
                }

                if (gpsData.success) {
                    const serverLocations = gpsData.data;
                    driverLocations = serverLocations;
                    if (monitoringMap) {
                        updateMapMarkers();
                        renderDriverList();
                        updateMonitoringStats();
                    }
                }
            } catch (e) {
                console.error('Error syncing real-time data', e);
            }
        }, 10000); // Sync notifications every 10s. Other syncs have their own loops.

        setInterval(async () => {
            try {
                const res = await fetch(API_BASE + '/tasks');
                const data = await res.json();
                if (data.success && data.data) {
                    tasks = data.data;
                    if (document.querySelector('[data-view="pending"]').classList.contains('active')) {
                        renderTasks();
                    }
                }
            } catch (e) { console.warn('Task synchronization error:', e); }
        }, 50000);

        // History synchronization every 30 seconds as requested
        setInterval(async () => {
            try {
                const res = await fetch(API_BASE + '/completed-tasks');
                const data = await res.json();
                if (data.success && data.data) {
                    completedTasks = data.data;
                    if (document.querySelector('[data-view="completed"]').classList.contains('active')) {
                        renderCompletedTasks();
                    }
                }
            } catch (e) { console.warn('History synchronization error:', e); }
        }, 30000);

        // Add manual sync listener for monitoring
        const btnSync = document.getElementById('btn-sync-monitoring');
        if (btnSync) {
            btnSync.addEventListener('click', async () => {
                const icon = btnSync.querySelector('i');
                if (icon) icon.style.transition = 'transform 0.5s';
                if (icon) icon.style.transform = 'rotate(360deg)';

                await initAppFromDB(); // Reload all data
                // Also trigger immediate GPS sync
                const res = await fetch(API_BASE + '/gps');
                const data = await res.json();
                if (data.success) {
                    driverLocations = data.data;
                    if (monitoringMap) {
                        updateMapMarkers();
                        renderDriverList();
                        updateMonitoringStats();
                    }
                }

                setTimeout(() => { if (icon) icon.style.transform = 'rotate(0deg)'; }, 500);
            });
        }

        lucide.createIcons();
    }

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        sessionStorage.removeItem('loggedUserId');
        if (gpsTrackingInterval) { clearInterval(gpsTrackingInterval); gpsTrackingInterval = null; }
        currentUser = null;
        appContainer.style.display = 'none';
        loginScreen.style.display = 'flex';
        document.getElementById('login-form').reset();
        loginError.style.display = 'none';
        lucide.createIcons();
    });

    // =============================================
    // ROLE-BASED UI SETUP
    // =============================================
    function setupRoleUI() {
        // Sidebar profile
        document.getElementById('sidebar-name').textContent = currentUser.name;
        document.getElementById('sidebar-role').textContent = currentUser.role;
        document.getElementById('sidebar-avatar').src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=4f46e5&color=fff`;

        // Nav items
        const navUsers = document.getElementById('nav-users');
        navUsers.style.display = currentUser.role === 'Administrador' ? '' : 'none';

        // Pending actions (create task, export) - admin/supervisor only
        const pendingActions = document.getElementById('pending-admin-actions');
        pendingActions.style.display = isAdmin() ? '' : 'none';

        // Completed actions
        const completedActions = document.getElementById('completed-admin-actions');
        if (completedActions) completedActions.style.display = isAdmin() ? '' : 'none';

        // Warehouse form - hide for everyone as per request (conductors use modal)
        const whForm = document.getElementById('warehouse-form-container');
        if (whForm) whForm.style.display = 'none';

        // E/S Create button - only for Conductor
        const btnCreateMov = document.getElementById('btn-create-movement');
        if (btnCreateMov) btnCreateMov.style.display = isConductor() ? '' : 'none';

        // Vehicles nav - admin/supervisor only
        const navVehicles = document.getElementById('nav-vehicles');
        navVehicles.style.display = isAdmin() ? '' : 'none';

        // Vehicles admin actions
        const vehActions = document.getElementById('vehicles-admin-actions');
        if (vehActions) vehActions.style.display = isAdmin() ? '' : 'none';

        // Monitoring nav - admin/supervisor only
        const navMonitoring = document.getElementById('nav-monitoring');
        navMonitoring.style.display = isAdmin() ? '' : 'none';

        // Notifications admin actions (compose notif)
        const notifActions = document.getElementById('notif-admin-actions');
        if (notifActions) notifActions.style.display = isAdmin() ? '' : 'none';
    }

    // =============================================
    // NAVIGATION
    // =============================================
    const navLinks = document.querySelectorAll('.nav-links li');
    const views = document.querySelectorAll('.view');
    const pageTitle = document.getElementById('page-title');
    const titles = { 'pending': 'Tareas Pendientes', 'completed': 'Historial de Entregas', 'warehouse': 'Control E/S Transportista', 'vehicles': 'Gestión de Vehículos', 'monitoring': 'Monitoreo de Vehículos', 'notifications': 'Centro de Notificaciones', 'users': 'Gestión de Usuarios' };

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (link.style.display === 'none') return;
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const v = link.getAttribute('data-view');
            pageTitle.textContent = titles[v];
            views.forEach(view => { view.classList.remove('active'); view.classList.add('hidden'); });
            const target = document.getElementById(`view-${v}`);
            target.classList.remove('hidden');
            target.classList.add('active');
            // Init map when monitoring view is opened
            if (v === 'monitoring') setTimeout(() => initMonitoringMap(), 100);
            // Refresh notifications view
            if (v === 'notifications') renderNotificationsPage();
        });
    });

    // =============================================
    // WAREHOUSE TABS & FORM (admin)
    // =============================================
    const warehouseForm = document.getElementById('warehouse-form');
    warehouseForm.addEventListener('submit', e => {
        e.preventDefault();
        const cod = document.getElementById('wh-codigo').value.trim();
        const cnt = document.getElementById('wh-cantidad').value;
        const ubi = document.getElementById('wh-ubicacion').value.trim();
        const observ = document.getElementById('wh-notas').value.trim();
        let notasFinales = `Paquete: ${cod}, Cantidad: ${cnt}`;
        if (ubi) notasFinales += `, Ubicación: ${ubi}`;
        if (observ) notasFinales += ` | Obs: ${observ}`;

        const newMov = {
            id: Date.now(),
            tipo: 'ingreso', // default for rapid entry, or we can assume it's an IN
            notas: notasFinales,
            fotos: [],
            fecha: getNowFormatted(),
            gps: 'Registro rápido',
            transportista: currentUser.name
        };
        newMov.id = Date.now();
        movements.unshift(newMov);
        apiCall('/movements', { method: 'POST', body: JSON.stringify(newMov) }).then(d => { if (d && d.success) newMov.id = d.id; });
        renderMovements();

        const btn = warehouseForm.querySelector('button');
        const orig = btn.textContent;
        btn.textContent = 'Procesando...'; btn.disabled = true;
        setTimeout(() => {
            btn.textContent = '¡Registrado!'; btn.style.backgroundColor = 'var(--success)';
            setTimeout(() => { btn.textContent = orig; btn.style.backgroundColor = ''; btn.disabled = false; warehouseForm.reset(); }, 1500);
        }, 800);
    });

    // =============================================
    // CREATE TASK MODAL (admin)
    // =============================================
    const modalOverlay = document.getElementById('modal-overlay');
    const btnCreateTask = document.getElementById('btn-create-task');
    const createTaskForm = document.getElementById('create-task-form');

    function openModal() {
        modalOverlay.classList.add('active');
        document.getElementById('task-date').value = new Date().toISOString().split('T')[0];

        // Populate conductors dropdown
        const transSelect = document.getElementById('task-transportista');
        transSelect.innerHTML = '<option value="Sin asignar">-- Sin asignar (Todos los conductores) --</option>';
        users.filter(u => u.role === 'Conductor' && u.status === 'activo').forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.name;
            opt.textContent = u.name;
            transSelect.appendChild(opt);
        });
    }
    function closeModal() { modalOverlay.classList.remove('active'); createTaskForm.reset(); }

    btnCreateTask.addEventListener('click', openModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-task').addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

    createTaskForm.addEventListener('submit', e => {
        e.preventDefault();
        const newTask = {
            id: Date.now(), client: document.getElementById('task-client').value.trim(),
            transportista: document.getElementById('task-transportista').value,
            bultos: parseInt(document.getElementById('task-bultos').value),
            guia: document.getElementById('task-guia').value.trim(),
            priority: document.getElementById('task-priority').value,
            date: document.getElementById('task-date').value,
            sector: document.getElementById('task-sector').value.trim(),
            description: document.getElementById('task-description').value.trim(),
            status: 'activo',
            createdBy: currentUser.name,
            createdAt: getNowFormatted()
        };
        newTask.id = Date.now();
        tasks.unshift(newTask);
        apiCall('/tasks', { method: 'POST', body: JSON.stringify(newTask) })
            .then(d => { if (d.success) newTask.id = d.id; });
        renderTasks(); closeModal();
    });

    // =============================================
    // RENDER TASKS
    // =============================================
    const taskListEl = document.getElementById('task-list');

    function renderTasks() {
        let displayTasks = tasks;
        if (isConductor()) {
            displayTasks = tasks.filter(t =>
                t.transportista === currentUser.name ||
                t.transportista === 'Sin asignar' ||
                !t.transportista
            );
        }

        taskListEl.innerHTML = '';
        if (displayTasks.length === 0) {
            taskListEl.innerHTML = `<div class="empty-state"><i data-lucide="inbox"></i><h3>No hay tareas pendientes</h3><p>${isConductor() ? 'No tienes tareas asignadas actualmente' : 'Crea una nueva tarea usando el botón "Nueva Tarea"'}</p></div>`;
            lucide.createIcons(); updateStats(displayTasks); return;
        }

        displayTasks.forEach(task => {
            const isHigh = task.priority === 'alta';
            const isActive = task.status === 'activo';
            const card = document.createElement('div');
            card.className = `task-card${isHigh ? ' priority-high' : ''}${!isActive ? ' task-inactive' : ''}`;

            let footerHTML;
            if (isConductor()) {
                footerHTML = `<div class="task-footer">
                    <div></div>
                    <div class="task-footer-right">
                        ${isActive ?
                        `<button class="btn btn-primary btn-complete-task" data-task-id="${task.id}"><i data-lucide="clipboard-check"></i> Completar Entrega</button>` :
                        `<button class="btn btn-disabled" disabled><i data-lucide="lock"></i> Tarea Inactiva</button>`
                    }
                    </div></div>`;
            } else {
                footerHTML = `<div class="task-footer">
                    <div class="task-footer-left">
                        <label class="toggle-switch" title="${isActive ? 'Desactivar' : 'Activar'}"><input type="checkbox" ${isActive ? 'checked' : ''} data-toggle-id="${task.id}"><span class="toggle-slider"></span></label>
                        <span class="toggle-label">${isActive ? 'Activo' : 'Inactivo'}</span>
                    </div>
                    <div class="task-footer-right">
                        <button class="btn-delete" data-id="${task.id}"><i data-lucide="trash-2"></i> Eliminar</button>
                        <button class="btn btn-primary">${isActive ? 'Iniciar Entrega' : 'Reactivar'}</button>
                    </div></div>`;
            }

            card.innerHTML = `
                <div class="task-header">
                    <div class="task-header-left">
                        <span class="tag ${isHigh ? 'high' : 'normal'}">${isHigh ? 'Alta Prioridad' : 'Normal'}</span>
                        <span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}"><span class="status-dot"></span> ${isActive ? 'Activo' : 'Inactivo'}</span>
                    </div>
                    <span class="time">ID #${task.id}</span>
                </div>
                <div class="task-body">
                    <h4>${task.description}</h4>
                    <p class="client"><i data-lucide="user"></i> ${task.client}</p>
                    <p class="address"><i data-lucide="map-pin"></i> Sector: ${task.sector}</p>
                    <div class="task-meta-row">
                        <span><i data-lucide="package"></i> ${task.bultos} Bultos</span>
                        <span><i data-lucide="file-text"></i> Guía: ${task.guia}</span>
                        <span><i data-lucide="truck"></i> ${task.transportista}</span>
                        <span><i data-lucide="calendar"></i> ${formatDate(task.date)}</span>
                    </div>
                </div>${footerHTML}`;
            taskListEl.appendChild(card);
        });

        lucide.createIcons();

        // Admin toggles & delete
        document.querySelectorAll('[data-toggle-id]').forEach(t => {
            t.addEventListener('change', () => {
                const task = tasks.find(x => x.id === parseInt(t.getAttribute('data-toggle-id'))); if (task) {
                    task.status = task.status === 'activo' ? 'inactivo' : 'activo';
                    renderTasks();
                    apiCall('/tasks/' + task.id, { method: 'PUT', body: JSON.stringify({ status: task.status }) });
                }
            });
        });
        document.querySelectorAll('.btn-delete[data-id]').forEach(b => {
            b.addEventListener('click', () => {
                const id = parseInt(b.getAttribute('data-id')); const t = tasks.find(x => x.id === id); if (t && confirm(`¿Eliminar tarea #${t.id}?\n${t.client}`)) {
                    tasks = tasks.filter(x => x.id !== id);
                    renderTasks();
                    apiCall('/tasks/' + id, { method: 'DELETE', body: JSON.stringify({ deletedBy: currentUser?.name || 'Sistema', deletedAt: getNowFormatted() }) });
                }
            });
        });
        // Conductor complete buttons
        document.querySelectorAll('.btn-complete-task').forEach(b => {
            b.addEventListener('click', () => openCompleteTaskModal(parseInt(b.getAttribute('data-task-id'))));
        });

        updateStats(displayTasks);
    }

    function updateStats(displayTasks) {
        const t = displayTasks || tasks;
        document.getElementById('stat-high').textContent = `${t.filter(x => x.priority === 'alta').length} Envíos`;
        document.getElementById('stat-total').textContent = `${t.length} Tareas`;
        document.getElementById('stat-bultos').textContent = `${t.reduce((s, x) => s + x.bultos, 0)} Bultos`;
    }

    // =============================================
    // COMPLETE TASK (CONDUCTOR)
    // =============================================
    const completeOverlay = document.getElementById('complete-task-overlay');
    const completeForm = document.getElementById('complete-task-form');
    let completingTaskId = null;
    let completionPhotos = [];

    function openCompleteTaskModal(taskId) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        completingTaskId = taskId;
        completionPhotos = [];
        renderPhotoGrid();

        document.getElementById('complete-task-summary').innerHTML = `
            <div class="summary-row"><strong>Cliente:</strong> ${task.client}</div>
            <div class="summary-row"><strong>Guía:</strong> ${task.guia}</div>
            <div class="summary-row"><strong>Bultos:</strong> ${task.bultos}</div>
            <div class="summary-row"><strong>Sector:</strong> ${task.sector}</div>
            <div class="summary-row"><strong>Descripción:</strong> ${task.description}</div>`;

        document.getElementById('complete-observacion').value = '';
        // Populate placa dropdown from vehicles
        const placaSelect = document.getElementById('complete-placa');
        placaSelect.innerHTML = '<option value="">Seleccionar vehículo...</option>';
        vehicles.filter(v => v.status === 'activo').forEach(v => {
            placaSelect.innerHTML += `<option value="${v.placa}">${v.placa} — ${v.modelo}</option>`;
        });
        placaSelect.value = '';
        document.getElementById('complete-responsable').value = currentUser.name;
        document.getElementById('complete-datetime').value = getNowFormatted();
        getGPS(document.getElementById('complete-gps'));

        completeOverlay.classList.add('active');
        lucide.createIcons();
    }

    function closeCompleteModal() { completeOverlay.classList.remove('active'); completeForm.reset(); completionPhotos = []; completingTaskId = null; }

    document.getElementById('complete-task-close').addEventListener('click', closeCompleteModal);
    document.getElementById('btn-cancel-complete').addEventListener('click', closeCompleteModal);
    completeOverlay.addEventListener('click', e => { if (e.target === completeOverlay) closeCompleteModal(); });

    // Photo handling for task completion
    const photoInput = document.getElementById('photo-input');
    photoInput.addEventListener('change', e => {
        Array.from(e.target.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = ev => { completionPhotos.push(ev.target.result); renderPhotoGrid(); };
            reader.readAsDataURL(file);
        });
        photoInput.value = '';
    });

    function renderPhotoGrid() {
        const grid = document.getElementById('photo-grid');
        grid.innerHTML = '';
        completionPhotos.forEach((src, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb photo-viewable';
            thumb.innerHTML = `<img src="${resolveImg(src)}" alt="Foto ${i + 1}"><button type="button" class="photo-remove" data-idx="${i}"><i data-lucide="x"></i></button>`;
            thumb.querySelector('img').addEventListener('click', () => openLightbox(resolveImg(src)));
            grid.appendChild(thumb);
        });
        const addBtn = document.createElement('label');
        addBtn.className = 'photo-add-btn';
        addBtn.setAttribute('for', 'photo-input');
        addBtn.innerHTML = '<i data-lucide="camera"></i><span>Agregar</span>';
        grid.appendChild(addBtn);

        document.getElementById('photo-counter').textContent = `${completionPhotos.length} / 1`;
        document.getElementById('photo-counter').style.color = completionPhotos.length >= 1 ? 'var(--success)' : 'var(--danger)';

        lucide.createIcons();
        grid.querySelectorAll('.photo-remove').forEach(b => {
            b.addEventListener('click', e => { e.stopPropagation(); completionPhotos.splice(parseInt(b.getAttribute('data-idx')), 1); renderPhotoGrid(); });
        });
    }

    completeForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (completionPhotos.length < 1) { alert('Debe agregar al menos 1 foto antes de completar la entrega.'); return; }
        if (!document.getElementById('complete-placa').value) { alert('Debe seleccionar un vehículo.'); return; }
        const task = tasks.find(t => t.id === completingTaskId); // Use the existing `completingTaskId` variable
        if (!task) return;

        const completed = {
            ...task,
            status: 'Completado',
            transportista: (!task.transportista || task.transportista === 'Sin asignar') ? currentUser.name : task.transportista,
            observacion: document.getElementById('complete-observacion').value.trim(),
            placa: document.getElementById('complete-placa').value,
            fotos: [...completionPhotos],
            completedAt: document.getElementById('complete-datetime').value,
            gps: document.getElementById('complete-gps').value,
            responsable: currentUser.name
        };

        try {
            // First POST the completed task
            const postRes = await apiCall('/completed-tasks', { method: 'POST', body: JSON.stringify(completed) });
            if (!postRes || !postRes.success) {
                alert('No se pudo guardar la tarea completada: ' + (postRes?.error || 'Error desconocido'));
                return;
            }

            // Then DELETE (soft-delete) the original task
            const delRes = await apiCall('/tasks/' + completingTaskId, { method: 'DELETE' });
            if (!delRes || !delRes.success) {
                alert('La tarea se guardó en historial, pero no se pudo eliminar de pendientes: ' + (delRes?.error || 'Error desconocido'));
            }

            // Update local state and UI
            tasks = tasks.filter(t => t.id !== completingTaskId);
            completedTasks.unshift(completed);

            renderTasks();
            renderCompletedTasks();
            closeCompleteModal();
        } catch (err) {
            alert('Error crítico de red: ' + err.message);
        }
    });

    // =============================================
    // RENDER COMPLETED TASKS
    // =============================================
    function renderCompletedTasks() {
        const container = document.getElementById('completed-list');
        const searchVal = document.getElementById('completed-search').value.toLowerCase().trim();
        const dateFilter = document.getElementById('completed-date-filter').value;

        let display = completedTasks;
        if (isConductor()) { display = completedTasks.filter(t => t.transportista === currentUser.name); }

        if (dateFilter) {
            display = display.filter(t => t.date === dateFilter || (t.completedAt && t.completedAt.includes(dateFilter)));
        }

        if (searchVal) {
            display = display.filter(t =>
                (t.transportista && t.transportista.toLowerCase().includes(searchVal)) ||
                (t.guia && t.guia.toLowerCase().includes(searchVal)) ||
                (t.client && t.client.toLowerCase().includes(searchVal))
            );
        }

        document.getElementById('completed-summary').textContent = `${display.length} Entregas`;

        if (display.length === 0) {
            container.innerHTML = `<div class="empty-state"><i data-lucide="check-circle-2"></i><h3>No hay entregas realizadas</h3><p>Las entregas completadas aparecerán aquí</p></div>`;
            lucide.createIcons(); return;
        }

        container.innerHTML = '';

        // Group by Date
        const groups = {};
        display.forEach(t => {
            const dateStr = t.date || (t.completedAt ? t.completedAt.split(' ')[0] : 'Sin fecha');
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(t);
        });

        // Sorted keys (descending date)
        const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

        sortedDates.forEach(date => {
            const groupHeader = document.createElement('div');
            groupHeader.className = 'history-group-header';
            groupHeader.innerHTML = `<h3><i data-lucide="calendar"></i> ${formatDate(date)}</h3>`;
            container.appendChild(groupHeader);

            groups[date].forEach(t => {
                const isOk = t.status === 'Completado';
                const item = document.createElement('div');
                item.className = 'history-item history-item-clickable';
                item.setAttribute('data-completed-id', t.id);
                item.innerHTML = `
                    <div class="status-indicator ${isOk ? 'done' : 'issue'}"></div>
                    <div class="history-details">
                        <h4>Entrega #${t.id} — ${t.client}</h4>
                        <p><i data-lucide="truck"></i> ${t.transportista} | Guía: ${t.guia}</p>
                        ${t.observacion ? `<p class="obs-line"><i data-lucide="message-square"></i> ${t.observacion}</p>` : ''}
                        ${t.placa ? `<p class="obs-line"><i data-lucide="car"></i> Placa: ${t.placa}</p>` : ''}
                        ${t.fotos && t.fotos.length > 0 ? `<p class="obs-line"><i data-lucide="image"></i> ${t.fotos.length} foto(s)</p>` : ''}
                        ${t.gps ? `<p class="obs-line"><i data-lucide="map-pin"></i> GPS: ${t.gps}</p>` : ''}
                    </div>
                    <div class="history-meta">
                        <span class="time">${t.completedAt || ''}</span>
                        <span class="badge ${isOk ? 'success' : 'warning'}">${t.status}</span>
                        <span class="detail-hint"><i data-lucide="eye"></i> Ver detalle</span>
                    </div>`;
                container.appendChild(item);
            });
        });

        lucide.createIcons();
        container.querySelectorAll('[data-completed-id]').forEach(el => {
            el.addEventListener('click', () => openCompletedDetail(parseInt(el.getAttribute('data-completed-id'))));
        });
    }

    // Add search listener
    document.getElementById('completed-search').addEventListener('input', renderCompletedTasks);

    // =============================================
    // COMPLETED TASK DETAIL / EDIT MODAL
    // =============================================
    const cdOverlay = document.getElementById('completed-detail-overlay');
    const cdForm = document.getElementById('completed-detail-form');
    let viewingCompletedId = null;

    function openCompletedDetail(taskId) {
        const t = completedTasks.find(x => x.id === taskId);
        if (!t) return;
        viewingCompletedId = taskId;

        // Fill info summary
        document.getElementById('completed-detail-info').innerHTML = `
            <div class="summary-row"><strong>ID:</strong> #${t.id}</div>
            <div class="summary-row"><strong>Cliente:</strong> ${t.client}</div>
            <div class="summary-row"><strong>Guía:</strong> ${t.guia}</div>
            <div class="summary-row"><strong>Bultos:</strong> ${t.bultos}</div>
            <div class="summary-row"><strong>Sector:</strong> ${t.sector}</div>
            <div class="summary-row"><strong>Descripción:</strong> ${t.description}</div>`;

        // Populate placa dropdown
        const plateSelect = document.getElementById('cd-placa');
        plateSelect.innerHTML = '<option value="">Seleccionar vehículo...</option>';
        vehicles.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.placa;
            opt.textContent = `${v.placa} — ${v.modelo}`;
            plateSelect.appendChild(opt);
        });

        // Fill editable / viewable fields
        document.getElementById('cd-observacion').value = t.observacion || '';
        document.getElementById('cd-placa').value = t.placa || '';
        document.getElementById('cd-responsable').value = t.responsable || '';
        document.getElementById('cd-datetime').value = t.completedAt || '';
        document.getElementById('cd-gps').value = t.gps || '';
        document.getElementById('cd-status').value = t.status || 'Completado';
        document.getElementById('cd-transportista').value = t.transportista || '';

        // Photos (read-only display)
        const photoGrid = document.getElementById('cd-photo-grid');
        photoGrid.innerHTML = '';
        if (t.fotos && t.fotos.length > 0) {
            t.fotos.forEach((src, i) => {
                const thumb = document.createElement('div');
                thumb.style.display = 'inline-block';
                thumb.style.marginRight = '10px';
                thumb.style.verticalAlign = 'top';
                thumb.innerHTML = `
                    <div class="photo-thumb" style="margin:0; width:100px; height:100px;">
                        <img src="${resolveImg(src)}" alt="Foto ${i + 1}">
                    </div>
                    <a href="${resolveImg(src)}" download="tarea_${t.id}_foto_${i + 1}.jpg" target="_blank" style="display:block; text-align:center; padding: 4px; font-size:11px; background:var(--primary); color:white; border-radius:4px; text-decoration:none; margin-top:5px; font-weight:bold;">
                        Descargar
                    </a>`;
                photoGrid.appendChild(thumb);
            });
        } else {
            photoGrid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sin fotos</p>';
        }
        document.getElementById('cd-photo-count').textContent = t.fotos ? t.fotos.length : 0;

        // Role-based: admin can edit, others view only
        const canEdit = isAdmin();
        document.querySelectorAll('.cd-field').forEach(f => {
            f.disabled = !canEdit;
            f.readOnly = !canEdit;
            if (f.tagName === 'SELECT') f.disabled = !canEdit;
        });
        document.getElementById('completed-detail-title').textContent = canEdit ? 'Editar Entrega Realizada' : 'Detalle de Entrega';
        document.getElementById('btn-save-cd').style.display = canEdit ? '' : 'none';

        cdOverlay.classList.add('active');
        lucide.createIcons();
    }

    function closeCompletedDetail() { cdOverlay.classList.remove('active'); viewingCompletedId = null; }
    document.getElementById('completed-detail-close').addEventListener('click', closeCompletedDetail);
    document.getElementById('btn-close-cd').addEventListener('click', closeCompletedDetail);
    cdOverlay.addEventListener('click', e => { if (e.target === cdOverlay) closeCompletedDetail(); });

    cdForm.addEventListener('submit', e => {
        e.preventDefault();
        if (!isAdmin()) return;
        const t = completedTasks.find(x => x.id === viewingCompletedId);
        if (!t) return;
        t.observacion = document.getElementById('cd-observacion').value.trim();
        t.placa = document.getElementById('cd-placa').value.trim();
        t.status = document.getElementById('cd-status').value;
        renderCompletedTasks();
        closeCompletedDetail();
        apiCall('/completed-tasks/' + viewingCompletedId, { method: 'PUT', body: JSON.stringify({ observacion: t.observacion, placa: t.placa, status: t.status }) });

    });

    document.getElementById('completed-date-filter').addEventListener('change', renderCompletedTasks);

    // =============================================
    // E/S MOVEMENTS
    // =============================================
    const esOverlay = document.getElementById('es-modal-overlay');
    const esForm = document.getElementById('es-form');
    let esPhotos = [];

    document.getElementById('btn-create-movement').addEventListener('click', () => {
        esPhotos = [];
        renderEsPhotoGrid();
        document.getElementById('es-tipo').value = '';
        document.getElementById('es-notas').value = '';
        document.getElementById('es-transportista').value = currentUser.name;
        document.getElementById('es-datetime').value = getNowFormatted();
        getGPS(document.getElementById('es-gps'));
        esOverlay.classList.add('active');
        lucide.createIcons();
    });

    function closeEsModal() { esOverlay.classList.remove('active'); esForm.reset(); esPhotos = []; }
    document.getElementById('es-modal-close').addEventListener('click', closeEsModal);
    document.getElementById('btn-cancel-es').addEventListener('click', closeEsModal);
    esOverlay.addEventListener('click', e => { if (e.target === esOverlay) closeEsModal(); });

    const esPhotoInput = document.getElementById('es-photo-input');
    esPhotoInput.addEventListener('change', e => {
        Array.from(e.target.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = ev => { esPhotos.push(ev.target.result); renderEsPhotoGrid(); };
            reader.readAsDataURL(file);
        });
        esPhotoInput.value = '';
    });

    function renderEsPhotoGrid() {
        const grid = document.getElementById('es-photo-grid');
        grid.innerHTML = '';
        esPhotos.forEach((src, i) => {
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb';
            thumb.innerHTML = `<img src="${resolveImg(src)}" alt="Foto ${i + 1}"><button type="button" class="photo-remove es-photo-rm" data-idx="${i}"><i data-lucide="x"></i></button>`;
            grid.appendChild(thumb);
        });
        const addBtn = document.createElement('label');
        addBtn.className = 'photo-add-btn';
        addBtn.setAttribute('for', 'es-photo-input');
        addBtn.innerHTML = '<i data-lucide="camera"></i><span>Agregar</span>';
        grid.appendChild(addBtn);
        document.getElementById('es-photo-counter').textContent = esPhotos.length;
        lucide.createIcons();
        grid.querySelectorAll('.es-photo-rm').forEach(b => {
            b.addEventListener('click', () => { esPhotos.splice(parseInt(b.getAttribute('data-idx')), 1); renderEsPhotoGrid(); });
        });
    }

    esForm.addEventListener('submit', e => {
        e.preventDefault();
        const newMov = {
            id: Date.now(),
            tipo: document.getElementById('es-tipo').value,
            notas: document.getElementById('es-notas').value.trim(),
            fotos: [...esPhotos],
            fecha: document.getElementById('es-datetime').value,
            gps: document.getElementById('es-gps').value,
            transportista: currentUser.name
        };
        newMov.id = Date.now();
        movements.unshift(newMov);
        apiCall('/movements', { method: 'POST', body: JSON.stringify(newMov) }).then(d => { if (d.success) newMov.id = d.id; });
        renderMovements();
        closeEsModal();
    });

    function renderMovements() {
        const log = document.getElementById('movement-log');
        let display = movements;
        if (isConductor()) { display = movements.filter(m => m.transportista === currentUser.name); }
        if (display.length === 0) {
            log.innerHTML = '<div class="empty-state"><i data-lucide="warehouse"></i><h3>Sin movimientos</h3></div>';
            lucide.createIcons(); return;
        }
        log.innerHTML = '';
        display.forEach(m => {
            const isEntry = m.tipo === 'ingreso';
            const item = document.createElement('div');
            item.className = `log-item ${isEntry ? 'entry' : 'exit'} log-item-clickable`;
            item.setAttribute('data-movement-id', m.id);
            item.innerHTML = `<i data-lucide="${isEntry ? 'arrow-down-circle' : 'arrow-up-circle'}"></i>
                <div><p class="log-title">${isEntry ? 'Ingreso' : 'Salida'}: ${m.notas || 'Sin notas'}</p>
                <p class="log-sub">${m.fecha} • ${m.transportista}${m.fotos.length ? ` • ${m.fotos.length} foto(s)` : ''}${m.gps ? ` • GPS: ${m.gps}` : ''}</p></div>
                <span class="detail-hint"><i data-lucide="eye"></i></span>`;
            log.appendChild(item);
        });
        lucide.createIcons();

        // Attach click to open detail modal
        log.querySelectorAll('[data-movement-id]').forEach(el => {
            el.addEventListener('click', () => openMovementDetail(parseInt(el.getAttribute('data-movement-id'))));
        });
    }

    // =============================================
    // MOVEMENT DETAIL MODAL
    // =============================================
    const mdOverlay = document.getElementById('movement-detail-overlay');

    function openMovementDetail(movId) {
        const m = movements.find(x => x.id === movId);
        if (!m) return;

        const isEntry = m.tipo === 'ingreso';
        document.getElementById('movement-detail-info').innerHTML = `
            <div class="summary-row"><strong>Tipo:</strong> ${isEntry ? 'Ingreso (Entrada)' : 'Salida (Despacho)'}</div>
            <div class="summary-row"><strong>Transportista:</strong> ${m.transportista}</div>
            <div class="summary-row"><strong>Notas:</strong> ${m.notas || 'Sin notas'}</div>
            <div class="summary-row"><strong>Fecha y Hora:</strong> ${m.fecha}</div>
            <div class="summary-row"><strong>Ubicación GPS:</strong> ${m.gps || 'No disponible'}</div>`;

        const photoGrid = document.getElementById('md-photo-grid');
        photoGrid.innerHTML = '';
        if (m.fotos && m.fotos.length > 0) {
            m.fotos.forEach((src, i) => {
                const thumb = document.createElement('div');
                thumb.className = 'photo-thumb';
                thumb.innerHTML = `<img src="${resolveImg(src)}" alt="Foto ${i + 1}">`;
                photoGrid.appendChild(thumb);
            });
        } else {
            photoGrid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Sin fotos</p>';
        }
        document.getElementById('md-photo-count').textContent = m.fotos ? m.fotos.length : 0;

        mdOverlay.classList.add('active');
        lucide.createIcons();
    }

    function closeMovementDetail() { mdOverlay.classList.remove('active'); }
    document.getElementById('movement-detail-close').addEventListener('click', closeMovementDetail);
    document.getElementById('btn-close-md').addEventListener('click', closeMovementDetail);
    mdOverlay.addEventListener('click', e => { if (e.target === mdOverlay) closeMovementDetail(); });

    // =============================================
    // EXPORT MODAL
    // =============================================
    const exportOverlay = document.getElementById('export-modal-overlay');
    const filterTransportista = document.getElementById('filter-transportista');
    const filterSector = document.getElementById('filter-sector');
    const filterFechaDesde = document.getElementById('filter-fecha-desde');
    const filterFechaHasta = document.getElementById('filter-fecha-hasta');
    const filterGuia = document.getElementById('filter-guia');
    let currentExportType = 'pending';

    function getSourceData() { return currentExportType === 'pending' ? tasks : completedTasks; }

    function openExportModal(type) {
        currentExportType = type;
        const data = getSourceData();
        document.getElementById('export-subtitle').textContent = type === 'pending' ? 'Exportar tareas pendientes' : 'Exportar tareas realizadas';
        const transps = [...new Set(data.map(t => t.transportista))].sort();
        filterTransportista.innerHTML = '<option value="">-- Todos --</option>';
        transps.forEach(t => { filterTransportista.innerHTML += `<option value="${t}">${t}</option>`; });
        const sectors = [...new Set(data.map(t => t.sector))].sort();
        filterSector.innerHTML = '<option value="">-- Todos --</option>';
        sectors.forEach(s => { filterSector.innerHTML += `<option value="${s}">${s}</option>`; });
        filterFechaDesde.value = ''; filterFechaHasta.value = ''; filterGuia.value = '';
        updateFilteredCount();
        exportOverlay.classList.add('active');
        lucide.createIcons();
    }

    function closeExportModal() { exportOverlay.classList.remove('active'); }

    function getFilteredData() {
        let data = [...getSourceData()];
        const tv = filterTransportista.value, sv = filterSector.value, fd = filterFechaDesde.value, fh = filterFechaHasta.value, gv = filterGuia.value.trim().toLowerCase();
        if (tv) data = data.filter(t => t.transportista === tv);
        if (sv) data = data.filter(t => t.sector === sv);
        if (fd) data = data.filter(t => t.date >= fd);
        if (fh) data = data.filter(t => t.date <= fh);
        if (gv) data = data.filter(t => t.guia.toLowerCase().includes(gv));
        return data;
    }

    function updateFilteredCount() {
        const n = getFilteredData().length;
        document.getElementById('export-count').textContent = `${n} tarea${n !== 1 ? 's' : ''} coincide${n !== 1 ? 'n' : ''} con los filtros`;
    }

    [filterTransportista, filterSector, filterFechaDesde, filterFechaHasta, filterGuia].forEach(el => {
        el.addEventListener('input', updateFilteredCount);
        el.addEventListener('change', updateFilteredCount);
    });

    function generateExcel(data, filename) {
        if (!data.length) { alert('No hay datos para exportar.'); return; }
        const rows = data.map(t => ({ 'ID': t.id, 'Cliente': t.client, 'Transportista': t.transportista, 'Bultos': t.bultos, 'Guía': t.guia, 'Prioridad': t.priority === 'alta' ? 'Alta' : 'Normal', 'Fecha': formatDate(t.date), 'Sector': t.sector, 'Descripción': t.description, 'Estado': t.status }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 8 }, { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 45 }, { wch: 12 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentExportType === 'pending' ? 'Pendientes' : 'Realizadas');
        XLSX.writeFile(wb, filename);
    }

    document.getElementById('btn-export-pending').addEventListener('click', () => openExportModal('pending'));
    document.getElementById('btn-export-completed').addEventListener('click', () => openExportModal('completed'));
    document.getElementById('btn-export-all').addEventListener('click', () => { generateExcel(getSourceData(), `Tareas_${new Date().toISOString().slice(0, 10)}.xlsx`); closeExportModal(); });
    document.getElementById('btn-export-filtered').addEventListener('click', () => { generateExcel(getFilteredData(), `Tareas_Filtrado_${new Date().toISOString().slice(0, 10)}.xlsx`); closeExportModal(); });
    document.getElementById('export-modal-close').addEventListener('click', closeExportModal);
    document.getElementById('btn-export-cancel').addEventListener('click', closeExportModal);
    exportOverlay.addEventListener('click', e => { if (e.target === exportOverlay) closeExportModal(); });

    // =============================================
    // USERS MODULE (admin)
    // =============================================
    const userModalOverlay = document.getElementById('user-modal-overlay');
    const createUserForm = document.getElementById('create-user-form');
    const editUserOverlay = document.getElementById('edit-user-modal-overlay');
    const editUserForm = document.getElementById('edit-user-form');
    let editingUserId = null;

    function openUserModal() { userModalOverlay.classList.add('active'); document.getElementById('user-date-display').value = getTodayFormatted(); document.getElementById('user-created-by').value = currentUser.name; lucide.createIcons(); }
    function closeUserModal() { userModalOverlay.classList.remove('active'); createUserForm.reset(); }

    document.getElementById('btn-create-user').addEventListener('click', openUserModal);
    document.getElementById('user-modal-close').addEventListener('click', closeUserModal);
    document.getElementById('btn-cancel-user').addEventListener('click', closeUserModal);
    userModalOverlay.addEventListener('click', e => { if (e.target === userModalOverlay) closeUserModal(); });

    createUserForm.addEventListener('submit', e => {
        e.preventDefault();
        const newUser = { id: Date.now(), name: document.getElementById('user-name').value.trim(), password: document.getElementById('user-password').value, role: document.getElementById('user-role').value, email: document.getElementById('user-email').value.trim(), createdAt: getTodayFormatted(), createdBy: currentUser.name, status: 'activo', modifiedBy: null, modifiedAt: null };
        newUser.id = Date.now();
        users.push(newUser);
        apiCall('/users', { method: 'POST', body: JSON.stringify(newUser) }).then(d => { if (d.success) newUser.id = d.id; });
        renderUsers(); closeUserModal();
    });

    function openEditUserModal(id) {
        const user = users.find(u => u.id === id); if (!user) return;
        editingUserId = id;
        document.getElementById('edit-user-name').value = user.name;
        document.getElementById('edit-user-password').value = '';
        document.getElementById('edit-user-role').value = user.role;
        document.getElementById('edit-user-email').value = user.email;
        document.getElementById('edit-user-date').value = getTodayFormatted();
        document.getElementById('edit-user-modified-by').value = currentUser.name;
        editUserOverlay.classList.add('active'); lucide.createIcons();
    }
    function closeEditUserModal() { editUserOverlay.classList.remove('active'); editUserForm.reset(); editingUserId = null; }

    document.getElementById('edit-user-modal-close').addEventListener('click', closeEditUserModal);
    document.getElementById('btn-cancel-edit-user').addEventListener('click', closeEditUserModal);
    editUserOverlay.addEventListener('click', e => { if (e.target === editUserOverlay) closeEditUserModal(); });

    editUserForm.addEventListener('submit', e => {
        e.preventDefault();
        const user = users.find(u => u.id === editingUserId); if (!user) return;
        user.role = document.getElementById('edit-user-role').value;
        user.email = document.getElementById('edit-user-email').value.trim();
        const np = document.getElementById('edit-user-password').value;
        if (np.trim()) user.password = np;
        user.modifiedBy = currentUser.name;
        user.modifiedAt = getTodayFormatted();
        renderUsers();
        closeEditUserModal();
        apiCall('/users/' + editingUserId, { method: 'PUT', body: JSON.stringify(user) });
    });

    function toggleUserStatus(id) { const u = users.find(u => u.id === id); if (u) { u.status = u.status === 'activo' ? 'inactivo' : 'activo'; renderUsers(); apiCall('/users/' + id, { method: 'PUT', body: JSON.stringify(u) }); } }
    function deleteUser(id) { const u = users.find(u => u.id === id); if (u && confirm(`¿Eliminar "${u.name}"?`)) { users = users.filter(u => u.id !== id); renderUsers(); apiCall('/users/' + id, { method: 'DELETE', body: JSON.stringify({ deletedBy: currentUser?.name || 'Sistema', deletedAt: getNowFormatted() }) }); } }

    const usersWrapper = document.getElementById('users-table-wrapper');
    function renderUsers() {
        const searchVal = document.getElementById('users-search').value.toLowerCase().trim();
        let display = users;
        if (searchVal) {
            display = users.filter(u => u.name.toLowerCase().includes(searchVal));
        }

        if (display.length === 0) { usersWrapper.innerHTML = `<div class="empty-state"><i data-lucide="users"></i><h3>No se encontraron usuarios</h3></div>`; lucide.createIcons(); updateUserStats(); return; }
        let html = `<table class="users-table"><thead><tr><th>Usuario</th><th>Clave</th><th>Rol</th><th>Correo</th><th>Fecha Creación</th><th>Creado Por</th><th>Modificado Por</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`;
        display.forEach(user => {
            const isA = user.status === 'activo';
            const rc = user.role.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const av = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=${isA ? '4f46e5' : '334155'}&color=fff&size=36`;
            const mod = user.modifiedBy ? `${user.modifiedBy}<div class="modify-info">${user.modifiedAt}</div>` : '<span style="opacity:0.4">—</span>';
            html += `<tr class="${!isA ? 'user-row-inactive' : ''}">
                <td><div class="user-cell"><img src="${av}" alt="${user.name}" class="user-avatar"><span class="user-name-text">${user.name}</span></div></td>
                <td><span class="password-masked">${'•'.repeat(user.password ? user.password.length : 4)}</span></td>
                <td><span class="role-badge role-${rc}">${user.role}</span></td>
                <td>${user.email}</td><td>${user.createdAt}</td><td>${user.createdBy}</td><td>${mod}</td>
                <td><div class="task-footer-left"><label class="toggle-switch"><input type="checkbox" ${isA ? 'checked' : ''} data-user-toggle="${user.id}"><span class="toggle-slider"></span></label></div></td>
                <td><div class="table-actions"><button class="btn-edit" data-user-edit="${user.id}"><i data-lucide="pencil"></i></button><button class="btn-delete" data-user-delete="${user.id}"><i data-lucide="trash-2"></i></button></div></td></tr>`;
        });
        html += '</tbody></table>';
        usersWrapper.innerHTML = html;
        lucide.createIcons();
        document.querySelectorAll('[data-user-toggle]').forEach(t => { t.addEventListener('change', () => toggleUserStatus(parseInt(t.getAttribute('data-user-toggle')))); });
        document.querySelectorAll('[data-user-edit]').forEach(b => { b.addEventListener('click', () => openEditUserModal(parseInt(b.getAttribute('data-user-edit')))); });
        document.querySelectorAll('[data-user-delete]').forEach(b => { b.addEventListener('click', () => deleteUser(parseInt(b.getAttribute('data-user-delete')))); });
        updateUserStats();
    }

    document.getElementById('users-search').addEventListener('input', renderUsers);

    function updateUserStats() {
        const total = users.length, active = users.filter(u => u.status === 'activo').length;
        document.getElementById('stat-users-total').textContent = total;
        document.getElementById('stat-users-active').textContent = active;
        document.getElementById('stat-users-inactive').textContent = total - active;
    }

    // =============================================
    // VEHICLES MODULE
    // =============================================
    const vehicleModalOverlay = document.getElementById('vehicle-modal-overlay');
    const createVehicleForm = document.getElementById('create-vehicle-form');
    const editVehicleOverlay = document.getElementById('edit-vehicle-modal-overlay');
    const editVehicleForm = document.getElementById('edit-vehicle-form');
    let editingVehicleId = null;
    let vehiclePhoto = '';
    let editVehiclePhoto = '';

    function openVehicleModal() {
        vehiclePhoto = '';
        renderVehPhotoGrid();
        createVehicleForm.reset();
        vehicleModalOverlay.classList.add('active');
        lucide.createIcons();
    }
    function closeVehicleModal() { vehicleModalOverlay.classList.remove('active'); createVehicleForm.reset(); vehiclePhoto = ''; }

    document.getElementById('btn-create-vehicle').addEventListener('click', openVehicleModal);
    document.getElementById('vehicle-modal-close').addEventListener('click', closeVehicleModal);
    document.getElementById('btn-cancel-vehicle').addEventListener('click', closeVehicleModal);
    vehicleModalOverlay.addEventListener('click', e => { if (e.target === vehicleModalOverlay) closeVehicleModal(); });

    // Vehicle photo handling (create)
    const vehPhotoInput = document.getElementById('veh-photo-input');
    vehPhotoInput.addEventListener('change', e => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = ev => { vehiclePhoto = ev.target.result; renderVehPhotoGrid(); };
            reader.readAsDataURL(e.target.files[0]);
        }
        vehPhotoInput.value = '';
    });

    function renderVehPhotoGrid() {
        const grid = document.getElementById('veh-photo-grid');
        grid.innerHTML = '';
        if (vehiclePhoto) {
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb photo-viewable';
            thumb.innerHTML = `<img src="${vehiclePhoto}" alt="Vehículo"><button type="button" class="photo-remove veh-photo-rm"><i data-lucide="x"></i></button>`;
            thumb.querySelector('img').addEventListener('click', () => openLightbox(vehiclePhoto));
            thumb.querySelector('.veh-photo-rm').addEventListener('click', e => { e.stopPropagation(); vehiclePhoto = ''; renderVehPhotoGrid(); });
            grid.appendChild(thumb);
        }
        const addBtn = document.createElement('label');
        addBtn.className = 'photo-add-btn';
        addBtn.setAttribute('for', 'veh-photo-input');
        addBtn.innerHTML = '<i data-lucide="camera"></i><span>Agregar</span>';
        grid.appendChild(addBtn);
        document.getElementById('veh-photo-counter').textContent = vehiclePhoto ? '1' : '0';
        lucide.createIcons();
    }

    createVehicleForm.addEventListener('submit', e => {
        e.preventDefault();
        if (!vehiclePhoto) { alert('Debe agregar una foto del vehículo.'); return; }
        const newVeh = {
            id: Date.now(),
            modelo: document.getElementById('vehicle-modelo').value.trim(),
            placa: document.getElementById('vehicle-placa').value.trim().toUpperCase(),
            foto: vehiclePhoto,
            status: 'activo'
        };
        newVeh.id = Date.now();
        vehicles.push(newVeh);
        apiCall('/vehicles', { method: 'POST', body: JSON.stringify(newVeh) }).then(d => { if (d.success) newVeh.id = d.id; });
        renderVehicles();
        closeVehicleModal();
    });

    // Edit vehicle
    function openEditVehicleModal(id) {
        const v = vehicles.find(x => x.id === id);
        if (!v) return;
        editingVehicleId = id;
        document.getElementById('edit-vehicle-modelo').value = v.modelo;
        document.getElementById('edit-vehicle-placa').value = v.placa;
        editVehiclePhoto = v.foto || '';
        renderEditVehPhotoGrid();
        editVehicleOverlay.classList.add('active');
        lucide.createIcons();
    }
    function closeEditVehicleModal() { editVehicleOverlay.classList.remove('active'); editVehicleForm.reset(); editingVehicleId = null; editVehiclePhoto = ''; }

    document.getElementById('edit-vehicle-modal-close').addEventListener('click', closeEditVehicleModal);
    document.getElementById('btn-cancel-edit-vehicle').addEventListener('click', closeEditVehicleModal);
    editVehicleOverlay.addEventListener('click', e => { if (e.target === editVehicleOverlay) closeEditVehicleModal(); });

    const editVehPhotoInput = document.getElementById('edit-veh-photo-input');
    editVehPhotoInput.addEventListener('change', e => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = ev => { editVehiclePhoto = ev.target.result; renderEditVehPhotoGrid(); };
            reader.readAsDataURL(e.target.files[0]);
        }
        editVehPhotoInput.value = '';
    });

    function renderEditVehPhotoGrid() {
        const grid = document.getElementById('edit-veh-photo-grid');
        grid.innerHTML = '';
        if (editVehiclePhoto) {
            const thumb = document.createElement('div');
            thumb.className = 'photo-thumb photo-viewable';
            thumb.innerHTML = `<img src="${editVehiclePhoto}" alt="Vehículo"><button type="button" class="photo-remove edit-veh-rm"><i data-lucide="x"></i></button>`;
            thumb.querySelector('img').addEventListener('click', () => openLightbox(editVehiclePhoto));
            thumb.querySelector('.edit-veh-rm').addEventListener('click', e => { e.stopPropagation(); editVehiclePhoto = ''; renderEditVehPhotoGrid(); });
            grid.appendChild(thumb);
        }
        const addBtn = document.createElement('label');
        addBtn.className = 'photo-add-btn';
        addBtn.setAttribute('for', 'edit-veh-photo-input');
        addBtn.innerHTML = '<i data-lucide="camera"></i><span>Agregar</span>';
        grid.appendChild(addBtn);
        document.getElementById('edit-veh-photo-counter').textContent = editVehiclePhoto ? '1' : '0';
        lucide.createIcons();
    }

    editVehicleForm.addEventListener('submit', e => {
        e.preventDefault();
        if (!editVehiclePhoto) { alert('Debe agregar una foto del vehículo.'); return; }
        const v = vehicles.find(x => x.id === editingVehicleId);
        if (!v) return;
        v.modelo = document.getElementById('edit-vehicle-modelo').value.trim();
        v.placa = document.getElementById('edit-vehicle-placa').value.trim().toUpperCase();
        v.foto = editVehiclePhoto;
        renderVehicles();
        closeEditVehicleModal();
        apiCall('/vehicles/' + editingVehicleId, { method: 'PUT', body: JSON.stringify({ modelo: v.modelo, placa: v.placa, status: v.status }) });
    });

    function toggleVehicleStatus(id) { const v = vehicles.find(x => x.id === id); if (v) { v.status = v.status === 'activo' ? 'inactivo' : 'activo'; renderVehicles(); apiCall('/vehicles/' + id, { method: 'PUT', body: JSON.stringify({ modelo: v.modelo, placa: v.placa, status: v.status }) }); } }
    function deleteVehicle(id) { const v = vehicles.find(x => x.id === id); if (v && confirm(`¿Eliminar vehículo "${v.placa}"?`)) { vehicles = vehicles.filter(x => x.id !== id); renderVehicles(); apiCall('/vehicles/' + id, { method: 'DELETE', body: JSON.stringify({ deletedBy: currentUser?.name || 'Sistema', deletedAt: getNowFormatted() }) }); } }

    const vehiclesWrapper = document.getElementById('vehicles-table-wrapper');
    function renderVehicles() {
        if (vehicles.length === 0) {
            vehiclesWrapper.innerHTML = '<div class="empty-state"><i data-lucide="car"></i><h3>No hay vehículos registrados</h3><p>Agregue vehículos para asignar placas</p></div>';
            lucide.createIcons(); updateVehicleStats(); return;
        }
        let html = `<table class="users-table"><thead><tr><th>Foto</th><th>Modelo</th><th>Placa</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>`;
        vehicles.forEach(v => {
            const isA = v.status === 'activo';
            const fotoHtml = v.foto
                ? `<div class="photo-thumb photo-viewable veh-table-thumb" data-veh-photo="${v.id}"><img src="${v.foto}" alt="${v.placa}"></div>`
                : '<span style="opacity:0.4">Sin foto</span>';
            html += `<tr class="${!isA ? 'user-row-inactive' : ''}">
                <td>${fotoHtml}</td>
                <td><strong>${v.modelo}</strong></td>
                <td><span class="role-badge role-conductor">${v.placa}</span></td>
                <td><div class="task-footer-left"><label class="toggle-switch"><input type="checkbox" ${isA ? 'checked' : ''} data-veh-toggle="${v.id}"><span class="toggle-slider"></span></label></div></td>
                <td><div class="table-actions"><button class="btn-edit" data-veh-edit="${v.id}"><i data-lucide="pencil"></i></button><button class="btn-delete" data-veh-delete="${v.id}"><i data-lucide="trash-2"></i></button></div></td></tr>`;
        });
        html += '</tbody></table>';
        vehiclesWrapper.innerHTML = html;
        lucide.createIcons();
        document.querySelectorAll('[data-veh-toggle]').forEach(t => { t.addEventListener('change', () => toggleVehicleStatus(parseInt(t.getAttribute('data-veh-toggle')))); });
        document.querySelectorAll('[data-veh-edit]').forEach(b => { b.addEventListener('click', () => openEditVehicleModal(parseInt(b.getAttribute('data-veh-edit')))); });
        document.querySelectorAll('[data-veh-delete]').forEach(b => { b.addEventListener('click', () => deleteVehicle(parseInt(b.getAttribute('data-veh-delete')))); });
        // Make vehicle photos clickable
        document.querySelectorAll('[data-veh-photo]').forEach(el => {
            const v = vehicles.find(x => x.id === parseInt(el.getAttribute('data-veh-photo')));
            if (v && v.foto) el.addEventListener('click', () => openLightbox(v.foto));
        });
        updateVehicleStats();
    }

    function updateVehicleStats() {
        const total = vehicles.length, active = vehicles.filter(v => v.status === 'activo').length;
        document.getElementById('stat-vehicles-total').textContent = total;
        document.getElementById('stat-vehicles-active').textContent = active;
    }

    // =============================================
    // PHOTO LIGHTBOX (ALL USERS)
    // =============================================
    const lightbox = document.getElementById('photo-lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxDownload = document.getElementById('lightbox-download');

    function openLightbox(src) {
        lightboxImg.src = src;
        lightboxDownload.href = src;
        lightbox.style.display = 'flex';
        lucide.createIcons();
    }
    function closeLightbox() { lightbox.style.display = 'none'; lightboxImg.src = ''; }

    document.getElementById('lightbox-close-btn').addEventListener('click', closeLightbox);
    document.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);

    // =============================================
    // MAKE ALL DETAIL MODAL PHOTOS CLICKABLE
    // =============================================
    // Override photo grid rendering in completed detail to add clickable
    const origOpenCD = openCompletedDetail;
    // Photos in completed detail are already rendered - add click after
    const cdObserver = new MutationObserver(() => {
        document.querySelectorAll('#cd-photo-grid .photo-thumb img').forEach(img => {
            if (!img.dataset.lightboxBound) {
                img.dataset.lightboxBound = 'true';
                img.classList.add('photo-viewable-img');
                img.addEventListener('click', () => openLightbox(img.src));
            }
        });
        document.querySelectorAll('#md-photo-grid .photo-thumb img').forEach(img => {
            if (!img.dataset.lightboxBound) {
                img.dataset.lightboxBound = 'true';
                img.classList.add('photo-viewable-img');
                img.addEventListener('click', () => openLightbox(img.src));
            }
        });
    });
    cdObserver.observe(document.getElementById('cd-photo-grid'), { childList: true, subtree: true });
    cdObserver.observe(document.getElementById('md-photo-grid'), { childList: true, subtree: true });

    // =============================================
    // GPS TRACKING FOR CONDUCTORS
    // =============================================
    function requestDriverGPS() {
        if (!navigator.geolocation) {
            alert('Su navegador no soporta geolocalización. Las funciones de GPS no estarán disponibles.');
            simulateDriverGPS();
            return;
        }
        // Ask for GPS permission
        if (confirm('🛰️ Activar GPS\n\nPara un mejor seguimiento de entregas, necesitamos acceso a su ubicación en tiempo real.\n\n¿Desea activar el GPS?')) {
            navigator.geolocation.getCurrentPosition(
                pos => {
                    updateDriverLocation(pos.coords.latitude, pos.coords.longitude);
                    // Start continuous tracking
                    gpsTrackingInterval = setInterval(() => {
                        navigator.geolocation.getCurrentPosition(
                            p => updateDriverLocation(p.coords.latitude, p.coords.longitude),
                            () => simulateDriverGPS(), { enableHighAccuracy: true }
                        );
                    }, 60000); // Sensors every 60 seconds as requested
                },
                () => { alert('No se pudo obtener su ubicación. Se usará una ubicación aproximada.'); simulateDriverGPS(); },
                { enableHighAccuracy: true }
            );
        } else {
            simulateDriverGPS();
        }
    }

    function simulateDriverGPS() {
        // Simulate GPS positions for demo (Quito area)
        const baseLat = -0.1807, baseLng = -78.4678;
        updateDriverLocation(baseLat + (Math.random() - 0.5) * 0.05, baseLng + (Math.random() - 0.5) * 0.05);
        gpsTrackingInterval = setInterval(() => {
            const prev = driverLocations[currentUser.id] || { lat: baseLat, lng: baseLng };
            updateDriverLocation(prev.lat + (Math.random() - 0.5) * 0.005, prev.lng + (Math.random() - 0.5) * 0.005);
        }, 60000);
    }

    function updateDriverLocation(lat, lng) {
        if (!currentUser) return;
        const driverName = currentUser.name;
        driverLocations[driverName] = {
            lat, lng,
            name: driverName,
            role: currentUser.role,
            lastUpdate: getNowFormatted(),
            online: true
        };
        // Send to server
        apiCall('/gps', {
            method: 'POST',
            body: JSON.stringify({
                driverId: currentUser.id,
                driverName: driverName,
                lat, lng
            })
        });
    }

    // Seed initial positions for demo conductors
    function seedDriverLocations() {
        const drivers = users.filter(u => u.role === 'Conductor' && u.status === 'activo');
        const baseLat = -0.1807, baseLng = -78.4678;
        drivers.forEach((d, i) => {
            if (!driverLocations[d.name]) {
                const lat = baseLat + (i - 0.5) * 0.015 + Math.random() * 0.01;
                const lng = baseLng + (i - 0.5) * 0.012 + Math.random() * 0.01;
                driverLocations[d.name] = {
                    lat,
                    lng,
                    name: d.name,
                    role: d.role,
                    lastUpdate: getNowFormatted(),
                    online: true
                };

                // seed server
                apiCall('/gps', {
                    method: 'POST',
                    body: JSON.stringify({
                        driverId: d.id,
                        driverName: d.name,
                        lat, lng
                    })
                });
            }
        });
    }

    // =============================================
    // MONITORING MAP (ADMIN/SUPERVISOR)
    // =============================================
    function initMonitoringMap() {
        seedDriverLocations();
        const mapEl = document.getElementById('monitoring-map');
        if (!mapEl) return;

        if (!mapInitialized) {
            let center = [-0.1807, -78.4678];
            const onlineDrivers = Object.values(driverLocations).filter(l => l.online);
            if (onlineDrivers.length > 0) center = [onlineDrivers[0].lat, onlineDrivers[0].lng];

            monitoringMap = L.map('monitoring-map').setView(center, 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(monitoringMap);
            mapInitialized = true;
        } else {
            monitoringMap.invalidateSize();
        }

        updateMapMarkers();
        renderDriverList();
        updateMonitoringStats();
    }

    function updateMapMarkers() {
        // Clear old markers
        Object.values(driverMarkers).forEach(m => monitoringMap.removeLayer(m));
        driverMarkers = {};

        Object.entries(driverLocations).forEach(([id, loc]) => {
            const driverIcon = L.divIcon({
                className: 'driver-map-icon',
                html: `<div style="background: ${loc.online ? '#10b981' : '#64748b'}; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; border: 3px solid white; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">${loc.name.charAt(0)}</div>`,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });
            const marker = L.marker([loc.lat, loc.lng], { icon: driverIcon }).addTo(monitoringMap);
            marker.bindPopup(`<div style="font-family:Outfit;"><strong>${loc.name}</strong><br><small>📍 ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}</small><br><small>🕐 ${loc.lastUpdate}</small></div>`);
            driverMarkers[id] = marker;
        });
    }

    function renderDriverList() {
        const list = document.getElementById('map-driver-list');
        list.innerHTML = '<h4 style="color:var(--text-main);font-size:0.9rem;margin-bottom:0.25rem;">Conductores</h4>';
        const drivers = users.filter(u => u.role === 'Conductor' && u.status === 'activo');
        if (drivers.length === 0) {
            list.innerHTML += '<p style="color:var(--text-muted);font-size:0.8rem;">Sin conductores activos</p>';
            return;
        }
        drivers.forEach(d => {
            const loc = driverLocations[d.name];
            const card = document.createElement('div');
            card.className = 'driver-card';
            const isOnline = loc && loc.online;
            card.innerHTML = `
                <div class="driver-status ${isOnline ? 'online' : 'offline'}"></div>
                <div>
                    <div class="driver-name">${d.name}</div>
                    <div class="driver-location">${loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : 'Sin señal'}</div>
                    <div class="driver-location">${loc ? loc.lastUpdate : ''} ${isOnline ? '<b>(En línea)</b>' : '(Desconectado)'}</div>
                </div>`;
            card.addEventListener('click', () => {
                if (loc && monitoringMap) monitoringMap.setView([loc.lat, loc.lng], 16);
            });
            list.appendChild(card);
        });
    }

    function updateMonitoringStats() {
        const online = Object.values(driverLocations).filter(l => l.online).length;
        document.getElementById('stat-drivers-online').textContent = online;
        document.getElementById('stat-last-update').textContent = getNowFormatted();
    }

    // =============================================
    // NOTIFICATION SYSTEM
    // =============================================
    function addNotification(type, message, from, targetUserIds) {
        const notif = {
            id: Date.now(),
            type, // info, warning, urgent, task
            message,
            from: from || 'Sistema',
            targetUserIds: targetUserIds || [], // empty = all users
            date: getNowFormatted(),
            read: false
        };
        notif.id = Date.now();
        notifications.unshift(notif);
        apiCall('/notifications', { method: 'POST', body: JSON.stringify(notif) }).then(d => { if (d.success) notif.id = d.id; });
        updateNotifBadge();
        renderNotifDropdown();
    }

    function getUserNotifications() {
        if (!currentUser) return [];
        return notifications.filter(n => {
            return n.targetUserIds.length === 0 || n.targetUserIds.includes(currentUser.id);
        });
    }

    function getUnreadCount() {
        return getUserNotifications().filter(n => !n.read).length;
    }

    function updateNotifBadge() {
        const badge = document.getElementById('notif-badge');
        const count = getUnreadCount();
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }

    function getNotifIcon(type) {
        const icons = { 'info': 'ℹ️', 'warning': '⚠️', 'urgent': '🔴', 'task': '📋' };
        return icons[type] || 'ℹ️';
    }

    function renderNotifDropdown() {
        const list = document.getElementById('notif-dropdown-list');
        const userNotifs = getUserNotifications().slice(0, 8);
        if (userNotifs.length === 0) {
            list.innerHTML = '<div class="notif-empty"><p>Sin notificaciones</p></div>';
            return;
        }
        list.innerHTML = '';
        userNotifs.forEach(n => {
            const div = document.createElement('div');
            div.className = `notif-item ${n.read ? '' : 'unread'}`;
            div.innerHTML = `
                <div class="notif-icon ${n.type}">${getNotifIcon(n.type)}</div>
                <div class="notif-content">
                    <div class="notif-text">${n.message}</div>
                    <div class="notif-from">${n.from}</div>
                    <div class="notif-time">${n.date}</div>
                </div>`;
            div.addEventListener('click', () => { n.read = true; updateNotifBadge(); renderNotifDropdown(); apiCall('/notifications/read/' + n.id, { method: 'PUT' }); });
            list.appendChild(div);
        });
    }

    function renderNotificationsPage() {
        const list = document.getElementById('notifications-full-list');
        const userNotifs = getUserNotifications();
        document.getElementById('stat-notif-total').textContent = userNotifs.length;
        document.getElementById('stat-notif-unread').textContent = userNotifs.filter(n => !n.read).length;
        if (userNotifs.length === 0) {
            list.innerHTML = '<div class="notif-empty"><i data-lucide="bell-off"></i><h3>Sin notificaciones</h3><p>Las alertas y mensajes aparecerán aquí</p></div>';
            lucide.createIcons(); return;
        }
        list.innerHTML = '';
        userNotifs.forEach(n => {
            const div = document.createElement('div');
            div.className = `notif-full-item ${n.read ? '' : 'unread'}`;
            div.innerHTML = `
                <div class="notif-icon ${n.type}">${getNotifIcon(n.type)}</div>
                <div class="notif-content">
                    <div class="notif-text">${n.message}</div>
                    <div class="notif-meta">
                        <span>De: ${n.from}</span>
                        <span>${n.date}</span>
                        <span>${n.read ? '✔ Leída' : '● No leída'}</span>
                    </div>
                </div>`;
            div.addEventListener('click', () => { n.read = true; renderNotificationsPage(); updateNotifBadge(); renderNotifDropdown(); apiCall('/notifications/read/' + n.id, { method: 'PUT' }); });
            list.appendChild(div);
        });
    }

    function initNotifications() {
        updateNotifBadge();
        renderNotifDropdown();
    }

    // Bell click toggle
    const notifBell = document.getElementById('btn-notif-bell');
    const notifDropdown = document.getElementById('notif-dropdown');
    notifBell.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = notifDropdown.style.display !== 'none';
        notifDropdown.style.display = isOpen ? 'none' : 'flex';
        if (!isOpen) renderNotifDropdown();
    });
    // Close dropdown on outside click
    document.addEventListener('click', e => {
        if (!document.getElementById('notif-bell-wrapper').contains(e.target)) {
            notifDropdown.style.display = 'none';
        }
    });

    // Mark all read
    document.getElementById('btn-mark-all-read').addEventListener('click', () => {
        getUserNotifications().forEach(n => n.read = true);
        apiCall('/notifications/read-all', { method: 'PUT', body: '{}' });
        updateNotifBadge();
        renderNotifDropdown();
    });

    // View all -> go to notifications view
    document.getElementById('btn-view-all-notif').addEventListener('click', () => {
        notifDropdown.style.display = 'none';
        const navNotif = document.querySelector('[data-view="notifications"]');
        if (navNotif) navNotif.click();
    });

    // Generate alerts for high priority tasks
    function generateHighPriorityAlerts() {
        // Obsolete: server auto generates them now
    }

    // =============================================
    // COMPOSE NOTIFICATION (ADMIN/SUPERVISOR)
    // =============================================
    const composeOverlay = document.getElementById('compose-notif-overlay');
    const composeForm = document.getElementById('compose-notif-form');

    function openComposeNotif() {
        // Populate dest dropdown with individual users
        const destSelect = document.getElementById('notif-dest');
        // Keep first 3 options (placeholder, todos, conductores), add users
        const base = Array.from(destSelect.options).slice(0, 3);
        destSelect.innerHTML = '';
        base.forEach(o => destSelect.appendChild(o));
        users.filter(u => u.status === 'activo').forEach(u => {
            const opt = document.createElement('option');
            opt.value = String(u.id);
            opt.textContent = `👤 ${u.name} (${u.role})`;
            destSelect.appendChild(opt);
        });
        destSelect.value = '';
        document.getElementById('notif-type').value = 'info';
        document.getElementById('notif-message').value = '';
        composeOverlay.classList.add('active');
        lucide.createIcons();
    }

    function closeComposeNotif() { composeOverlay.classList.remove('active'); composeForm.reset(); }
    document.getElementById('btn-compose-notif').addEventListener('click', openComposeNotif);
    document.getElementById('compose-notif-close').addEventListener('click', closeComposeNotif);
    document.getElementById('btn-cancel-notif').addEventListener('click', closeComposeNotif);
    composeOverlay.addEventListener('click', e => { if (e.target === composeOverlay) closeComposeNotif(); });

    composeForm.addEventListener('submit', e => {
        e.preventDefault();
        const dest = document.getElementById('notif-dest').value;
        const type = document.getElementById('notif-type').value;
        const message = document.getElementById('notif-message').value.trim();
        if (!message) return;

        let targetIds = [];
        if (dest === '__ALL__') {
            targetIds = []; // empty = all
        } else if (dest === '__CONDUCTORES__') {
            targetIds = users.filter(u => u.role === 'Conductor' && u.status === 'activo').map(u => u.id);
        } else {
            targetIds = [parseInt(dest)];
        }

        const destLabel = dest === '__ALL__' ? 'Todos' : dest === '__CONDUCTORES__' ? 'Conductores' : users.find(u => u.id === parseInt(dest))?.name || 'Usuario';
        addNotification(type, message, currentUser.name, targetIds);
        alert(`✅ Notificación enviada a: ${destLabel}`);
        closeComposeNotif();
    });

    // =============================================
    // ESCAPE KEY
    // =============================================
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (lightbox.style.display !== 'none') { closeLightbox(); return; }
            if (notifDropdown.style.display !== 'none') { notifDropdown.style.display = 'none'; return; }
            if (modalOverlay.classList.contains('active')) closeModal();
            if (exportOverlay.classList.contains('active')) closeExportModal();
            if (userModalOverlay.classList.contains('active')) closeUserModal();
            if (editUserOverlay.classList.contains('active')) closeEditUserModal();
            if (completeOverlay.classList.contains('active')) closeCompleteModal();
            if (esOverlay.classList.contains('active')) closeEsModal();
            if (cdOverlay.classList.contains('active')) closeCompletedDetail();
            if (mdOverlay.classList.contains('active')) closeMovementDetail();
            if (vehicleModalOverlay.classList.contains('active')) closeVehicleModal();
            if (editVehicleOverlay.classList.contains('active')) closeEditVehicleModal();
            if (composeOverlay.classList.contains('active')) closeComposeNotif();
        }
    });
});



