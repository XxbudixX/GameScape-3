const MAPTILER_KEY = 'qXZMMqoofeJQqdk8nsv1';
const MAPTILER_STYLE = `https://api.maptiler.com/maps/019d1f6a-0bb2-7db3-a9c7-670e85ac0f84/style.json?key=${MAPTILER_KEY}`;

// Hardcoded player data. Each player has an avatarSeed (DiceBear) and mapVisible flag.
const PLAYERS = [
    { id: 1,  gamertag: 'NightOwl_SE',   games: ['Valorant', 'CS2'],           rank: 'Diamond',    status: 'active',  lng: 13.002, lat: 55.607, lastActive: 'Just now',   age: 24, location: 'malmo',     avatarSeed: 'nightowl',    mapVisible: true },
    { id: 2,  gamertag: 'ProPlayer_99',  games: ['Minecraft', 'Fortnite'],      rank: 'Gold',       status: 'recent',  lng: 13.018, lat: 55.612, lastActive: '12 min ago',  age: 19, location: 'malmo',     avatarSeed: 'proplayer',   mapVisible: true },
    { id: 3,  gamertag: 'ZeroGrav',      games: ['League of Legends'],          rank: 'Platinum',   status: 'active',  lng: 12.995, lat: 55.598, lastActive: 'Just now',   age: 28, location: 'goteborg',  avatarSeed: 'zerograv',    mapVisible: true },
    { id: 4,  gamertag: 'StealthMode_K', games: ['Valorant', 'Apex Legends'],   rank: 'Challenger', status: 'active',  lng: 13.010, lat: 55.615, lastActive: 'Just now',   age: 22, location: 'stockholm', avatarSeed: 'stealth',     mapVisible: true },
    { id: 5,  gamertag: 'CasualGamer88', games: ['Minecraft'],                  rank: 'Unranked',   status: 'recent',  lng: 13.025, lat: 55.595, lastActive: '1 hour ago', age: 31, location: 'goteborg',  avatarSeed: 'casualgamer', mapVisible: true },
    { id: 6,  gamertag: 'SniperWolf',    games: ['CS2', 'Valorant'],            rank: 'Master',     status: 'active',  lng: 13.005, lat: 55.600, lastActive: 'Just now',   age: 26, location: 'malmo',     avatarSeed: 'sniperwolf',  mapVisible: true },
    { id: 7,  gamertag: 'NoobMaster69',  games: ['Fortnite'],                   rank: 'Silver',     status: 'offline', lng: 13.015, lat: 55.620, lastActive: '2 days ago', age: 17, location: 'stockholm', avatarSeed: 'noobmaster',  mapVisible: true },
    // Demo player — represents the logged-in user on the map
    { id: 99, gamertag: 'Demo',          games: ['Valorant', 'CS2', 'Fortnite'],rank: 'Gold',       status: 'active',  lng: 13.008, lat: 55.603, lastActive: 'Just now',   age: 22, location: 'malmo',     avatarSeed: 'GameScape',   mapVisible: true, isDemo: true },
];

// The demo player's map-visibility preference (persisted in localStorage)
const DEMO_VISIBLE_KEY = 'gamescape_demo_visible';
function getDemoVisible() {
    const v = localStorage.getItem(DEMO_VISIBLE_KEY);
    return v === null ? true : v === 'true';
}
function setDemoVisible(val) {
    localStorage.setItem(DEMO_VISIBLE_KEY, String(val));
    const demo = PLAYERS.find(p => p.isDemo);
    if (demo) demo.mapVisible = val;
    renderMapMarkers(getVisiblePlayers());
    refreshEventMarkers();
}
// Init demo visibility from storage
PLAYERS.find(p => p.isDemo).mapVisible = getDemoVisible();

function getVisiblePlayers() {
    return PLAYERS.filter(p => p.mapVisible);
}

// Maps player status to a dot color on the map. Active = green, recently active = orange, offline = grey.
const MARKER_COLORS = {
    active: '#39d98a',
    recent: '#f5a623',
    offline: '#6c6f78',
};

// Initializes the MapLibre map centered roughly over Malmö.
// antialias: true gives smoother circle edges for the player markers.
const map = new maplibregl.Map({
    container: 'map',
    style: MAPTILER_STYLE,
    center: [13.008, 55.605],
    zoom: 13,
    pitch: 0,
    bearing: 0,
    antialias: true
});

map.addControl(new maplibregl.NavigationControl({
    showCompass: true,
    showZoom: true,
    visualizePitch: true
}), 'bottom-right');

// Global login state. Kept here so any part of the page can check if the user is logged in
// without making another API call.
let isLoggedIn = false;
let currentUsername = null;


// Updates the global login state and refreshes anything in the UI that depends on it.
// Also updates the avatar image to match the logged-in user's generated avatar.
// Input: status (bool), username (string or null).
function setLoggedIn(status, username) {
    isLoggedIn = status;
    currentUsername = username || null;
    updateLoginLogoutButton();

    const avatarImg = document.querySelector('.avatar-img');
    if (avatarImg && username) {
        avatarImg.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
        avatarImg.alt = username;
    }

    // Update demo player gamertag to match logged-in username
    if (status && username) {
        const demo = PLAYERS.find(p => p.isDemo);
        if (demo) {
            demo.gamertag   = username;
            demo.avatarSeed = username;
        }
    }
}

// Called by profile.js (inside iframe) to toggle the demo player's map visibility
window.setDemoVisible = setDemoVisible;


// Asks the Flask backend whether the current browser session has a logged-in user.
// Called on page load so that if the user refreshed the page, they stay logged in.
// No input. Updates global login state as a side effect.
async function checkSession() {
    try {
        const res = await fetch('/api/me', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.logged_in) {
            setLoggedIn(true, data.username);
        }
    } catch (e) {
        console.warn('Session check failed:', e);
    }
}


// Opens a modal dialog by creating an overlay and an iframe pointed at the given page.
// The iframe approach means login, register, and profile each live in their own HTML file
// without polluting the main page's DOM or CSS.
// Clicking the overlay or pressing Escape closes the modal.
// Input: page (string) — a relative path to an HTML file, e.g. 'login/login.html'.
function openModalPage(page) {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modalOverlay';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closeModalPage);
    }
    
    let modalFrame = document.getElementById('modalFrame');
    if (!modalFrame) {
        modalFrame = document.createElement('iframe');
        modalFrame.id = 'modalFrame';
        modalFrame.className = 'modal-frame';
        document.body.appendChild(modalFrame);
    }
    
    modalFrame.src = page;
    overlay.classList.add('show');
    modalFrame.classList.add('show');
    
    function handleEscape(e) {
        if (e.key === 'Escape') {
            closeModalPage();
            document.removeEventListener('keydown', handleEscape);
        }
    }
    document.addEventListener('keydown', handleEscape);
}


// Closes the modal and clears the iframe src after the CSS transition finishes.
// Clearing the src stops the iframe from continuing to run its JavaScript in the background.
// No input. No return value.
function closeModalPage() {
    const overlay = document.getElementById('modalOverlay');
    const modalFrame = document.getElementById('modalFrame');
    
    if (overlay) overlay.classList.remove('show');
    if (modalFrame) {
        modalFrame.classList.remove('show');
        setTimeout(() => {
            if (modalFrame) modalFrame.src = 'about:blank';
        }, 300);
    }
}


// DOM map for custom avatar markers: playerId → { marker, el }
const playerMarkers = {};

// Injects shared avatar-marker styles once
function ensureMarkerStyles() {
    if (document.getElementById('avatar-marker-styles')) return;
    const s = document.createElement('style');
    s.id = 'avatar-marker-styles';
    s.textContent = `
        /* Outer wrapper — zero size so the marker anchors to the exact coordinate.
           All children are absolutely positioned around this 0×0 center point. */
        .avatar-marker {
            position: relative;
            width: 0;
            height: 0;
            cursor: pointer;
        }
        /* The actual avatar image, centered on the anchor point */
        .avatar-marker img {
            position: absolute;
            width: 40px;
            height: 40px;
            top: -20px;
            left: -20px;
            border-radius: 50%;
            border: 2.5px solid #1e1f22;
            display: block;
            transition: transform 0.15s;
            z-index: 2;
        }
        .avatar-marker:hover img { transform: scale(1.12); }
        /* Status dot: bottom-right of the avatar */
        .avatar-marker .status-ring {
            position: absolute;
            bottom: -20px;
            right: -20px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 2px solid #0e0f12;
            z-index: 3;
            transform: translate(50%, -50%);
        }
        .avatar-marker.demo-marker img {
            border-color: #c084fc;
            box-shadow: 0 0 10px rgba(192,132,252,0.6);
        }
        /* Pulse rings sit behind the avatar, anchored to the same 0×0 center */
        .avatar-marker .pulse-ring {
            position: absolute;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            border: 2px solid #39d98a;
            top: -13px;
            left: -13px;
            animation: event-pulse 2.4s ease-out infinite;
            opacity: 0;
            z-index: 1;
        }
        .avatar-marker .pulse-ring.delay1 { animation-delay: 0.8s; }
        .avatar-marker .pulse-ring.delay2 { animation-delay: 1.6s; }
    `;
    document.head.appendChild(s);
}

// Builds one avatar marker element for a player
function buildAvatarMarkerEl(player) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-marker' + (player.isDemo ? ' demo-marker' : '');

    const img = document.createElement('img');
    img.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.avatarSeed || player.gamertag)}`;
    img.alt = player.gamertag;
    wrap.appendChild(img);

    const dot = document.createElement('div');
    dot.className = 'status-ring';
    dot.style.background = player.status === 'active' ? '#39d98a' : player.status === 'recent' ? '#f5a623' : '#6c6f78';
    wrap.appendChild(dot);

    wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        const evt = activeEvents.find(ev => ev.playerId === player.id);
        if (evt) showEventPopup(player, evt);
        else     showMiniProfile(player);
    });

    // Tooltip on hover
    let hoverPopup = null;
    wrap.addEventListener('mouseenter', () => {
        const statusLabel = player.status === 'active' ? 'Active now' : player.status === 'recent' ? `Active ${player.lastActive}` : 'Offline';
        hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: [0, -44] })
            .setLngLat([player.lng, player.lat])
            .setHTML(`<strong>${player.gamertag}</strong><br><span style="font-size:11px;color:#aaa">${statusLabel}</span>`)
            .addTo(map);
    });
    wrap.addEventListener('mouseleave', () => { if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; } });

    return wrap;
}

// Renders/updates the avatar markers for the given player list.
// Removes markers for players no longer in the list.
function renderMapMarkers(playerList) {
    ensureMarkerStyles();
    // Remove markers not in new list
    Object.keys(playerMarkers).forEach(id => {
        if (!playerList.find(p => p.id === parseInt(id))) {
            playerMarkers[id].marker.remove();
            delete playerMarkers[id];
        }
    });
    // Add or update
    playerList.forEach(player => {
        if (playerMarkers[player.id]) return; // already on map
        const el     = buildAvatarMarkerEl(player);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([player.lng, player.lat])
            .addTo(map);
        playerMarkers[player.id] = { marker, el };
    });
    updatePlayerCount(playerList);
}

// Runs when the map finishes loading its tiles and style.
map.on('load', () => {
    console.log('Map loaded');
    renderMapMarkers(getVisiblePlayers());
});

map.on('error', (e) => {
    console.error('Map error:', e);
    alert('Map failed to load. Check your MapTiler API key.');
});


// Updates the bottom-left player count badge with total players and how many are active right now.
// Input: players (array of player objects).
function updatePlayerCount(players) {
    const activeCount = players.filter(p => p.status === 'active').length;
    const countText = document.getElementById('countText');
    if (countText) {
        countText.textContent = `${players.length} players nearby · ${activeCount} active now`;
    }
}


// Replaces the visible markers with a filtered list and updates the count badge.
function renderPlayers(playerList) {
    renderMapMarkers(playerList);
}


// Opens a full player profile card in a modal overlay when a map marker is clicked.
// Builds the card HTML dynamically so there's no separate HTML file needed for it.
// The modal styles are injected into <head> once on first use to avoid duplicating them.
// Input: player (object) — one entry from the PLAYERS array.
function openPlayerModal(player) {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modalOverlay';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closePlayerModal);
    }
    
    let modalContainer = document.getElementById('dynamicModalContainer');
    if (!modalContainer) {
        modalContainer = document.createElement('div');
        modalContainer.id = 'dynamicModalContainer';
        modalContainer.className = 'modal-frame';
        document.body.appendChild(modalContainer);
    }
    
    const statusText = { active: 'Active now', recent: `Active ${player.lastActive}`, offline: 'Offline' }[player.status];
    const statusColor = { active: '#39d98a', recent: '#f5a623', offline: '#6c6f78' }[player.status];
    const gameTags = player.games.map(game => `<span class="modal-game-tag">${game}</span>`).join('');
    
    modalContainer.innerHTML = `
        <div class="player-modal">
            <button class="close-btn-modal" onclick="window.closePlayerModal()">✕</button>
            <div class="player-modal-header">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.avatarSeed || player.gamertag)}" class="player-avatar-img" alt="${player.gamertag}">
                <div class="player-info">
                    <div class="player-name">${player.gamertag}</div>
                    <div class="player-status" style="color: ${statusColor};">● ${statusText}</div>
                </div>
            </div>
            <div class="player-section">
                <div class="section-label">Games</div>
                <div class="player-games">${gameTags}</div>
            </div>
            <div class="player-section">
                <div class="section-label">Rank</div>
                <div class="player-rank">${player.rank}</div>
            </div>
            <div class="player-section">
                <div class="section-label">Age</div>
                <div class="player-age">${player.age}</div>
            </div>
            <button class="modal-chat-btn" onclick="alert('Chat with ${player.gamertag} coming soon')">💬 Start Chat</button>
        </div>
    `;
    
    // Only inject the styles once — checking by id prevents duplicating the <style> tag
    // every time a player card is opened.
    if (!document.getElementById('player-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'player-modal-styles';
        style.textContent = `
            .player-modal {
                width: 100%;
                height: 100%;
                background: rgba(14, 15, 18, 0.95);
                backdrop-filter: blur(32px);
                border-radius: 28px;
                padding: 30px 25px 35px 25px;
                color: #dbdee1;
                position: relative;
                box-sizing: border-box;
                border: 1px solid rgba(155, 89, 182, 0.3);
            }
            .player-modal::before {
                content: '';
                position: absolute;
                top: -2px;
                left: -2px;
                right: -2px;
                bottom: -2px;
                background: linear-gradient(90deg, 
                    transparent, 
                    #9b59b6, 
                    #c084fc, 
                    #e9d5ff, 
                    #c084fc, 
                    #9b59b6, 
                    transparent);
                border-radius: 30px;
                z-index: -2;
                animation: neon-sweep 3s linear infinite;
                background-size: 200% 100%;
                pointer-events: none;
            }
            .player-modal::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                right: 2px;
                bottom: 2px;
                background: rgba(14, 15, 18, 0.95);
                backdrop-filter: blur(32px);
                border-radius: 26px;
                z-index: -1;
                pointer-events: none;
            }
            @keyframes neon-sweep {
                0% { background-position: 100% 0; }
                100% { background-position: -100% 0; }
            }
            .close-btn-modal {
                position: absolute;
                top: 15px;
                right: 15px;
                background: rgba(30, 31, 34, 0.6);
                border: 1px solid rgba(155, 89, 182, 0.4);
                color: #c084fc;
                font-size: 16px;
                cursor: pointer;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                z-index: 10;
            }
            .close-btn-modal:hover {
                background: rgba(155, 89, 182, 0.2);
                border-color: rgba(155, 89, 182, 0.8);
            }
            .player-modal-header {
                display: flex;
                align-items: center;
                gap: 15px;
                margin-bottom: 25px;
            }
            .player-avatar-img {
                width: 62px;
                height: 62px;
                border-radius: 50%;
                border: 2.5px solid #9b59b6;
                box-shadow: 0 0 12px rgba(155,89,182,0.4);
                object-fit: cover;
                flex-shrink: 0;
            }
            .player-name {
                font-size: 20px;
                font-weight: 700;
            }
            .player-status {
                font-size: 12px;
                margin-top: 5px;
            }
            .player-section {
                margin-bottom: 18px;
            }
            .section-label {
                font-size: 11px;
                font-weight: 600;
                color: #c084fc;
                text-transform: uppercase;
                letter-spacing: 1px;
                margin-bottom: 6px;
            }
            .player-games {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .modal-game-tag {
                background: rgba(30, 31, 34, 0.7);
                border: 1px solid rgba(155, 89, 182, 0.3);
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 12px;
            }
            .player-rank, .player-age {
                font-size: 15px;
                font-weight: 500;
            }
            .modal-chat-btn {
                width: 100%;
                background: linear-gradient(135deg, #9b59b6, #7c3aed);
                border: none;
                color: white;
                padding: 12px;
                border-radius: 40px;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                margin-top: 15px;
                transition: all 0.2s;
            }
            .modal-chat-btn:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }
        `;
        document.head.appendChild(style);
    }
    
    overlay.classList.add('show');
    modalContainer.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // window.closePlayerModal is already defined at top level as closePlayerModalSafe.
    
    function handleEscape(e) {
        if (e.key === 'Escape') {
            window.closePlayerModal();
            document.removeEventListener('keydown', handleEscape);
        }
    }
    document.addEventListener('keydown', handleEscape);
}


// Collapses the right sidebar back to its empty state.
// Called when the user clicks somewhere on the map outside a marker.
// No input. No return value.
function closePanel() {
    const sidebar = document.getElementById('sidebar');
    const sidebarEmpty = document.getElementById('sidebarEmpty');
    const profileCard = document.getElementById('profileCard');
    
    if (sidebar) sidebar.classList.remove('open');
    if (sidebarEmpty) sidebarEmpty.style.display = 'flex';
    if (profileCard) profileCard.style.display = 'none';
}


// Placeholder for the chat feature — not yet implemented.
// Input: playerId (number). No return value.
function openChat(playerId) {
    console.log('Opening chat with player ID:', playerId);
    alert('Chat feature coming soon! (Zakaria will implement this)');
}

// Top-level modal close — always defined so map click can call it any time
function closePlayerModalSafe() {
    const overlay = document.getElementById('modalOverlay');
    const container = document.getElementById('dynamicModalContainer');
    if (overlay) overlay.classList.remove('show');
    if (container) {
        container.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(() => { if (container) container.innerHTML = ''; }, 300);
    }
}
window.closePlayerModal = closePlayerModalSafe;

// Close everything when clicking anywhere on the map.
map.on('click', () => {
    closePanel();
    closeAllPopups();
    closePlayerModalSafe();
    closeModalPage();       // profile / login / register iframe modal
    closeFilterDropdown();  // filter dropdown panel
});


// Opens and closes the hamburger menu by toggling CSS classes.
// The overlay behind the menu is also toggled so clicking outside the menu closes it.
function toggleMenu() {
    document.getElementById('sideMenu')?.classList.toggle('open');
    document.getElementById('menuOverlay')?.classList.toggle('show');
}

function closeMenu() {
    document.getElementById('sideMenu')?.classList.remove('open');
    document.getElementById('menuOverlay')?.classList.remove('show');
}


// Changes the login/logout menu label based on current login state.
// Called whenever login state changes so the menu always shows the right option.
// No input. No return value.
function updateLoginLogoutButton() {
    const textSpan = document.getElementById('loginLogoutText');
    if (textSpan) textSpan.textContent = isLoggedIn ? 'Logout' : 'Login';
}


// Sends the logout request to the Flask backend and updates the UI.
// The session is cleared server-side; the client state is also reset here.
// No input. No return value.
async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });

    } catch (e) {
        console.warn('Logout request failed:', e);
    }
    setLoggedIn(false, null);
    if (window.checkAdmin){
        window.checkAdmin();
    }
    alert('Logged out successfully');
}


// Routes each hamburger menu item to the right action.
// Some items navigate to other pages, some open modals, some are still placeholders.
// Input: page (string) — the data-page attribute from the clicked menu item.
function handleMenuClick(page) {
    closeMenu();
    switch(page) {
        case 'home':
            map.invalidateSize();   // force the map to recalculate its size in case it shifted
            break;
        case 'chat':
            window.location.href = 'chat/chat.html';
            break;
        case 'notifications':
            alert('Notifications - Placeholder for now');
            break;
        case 'settings':
            alert('Settings - Coming soon!');
            break;
        case 'login':
            if (isLoggedIn) {
                handleLogout();
            } else {
                openModalPage('login/login.html');
            }
            break;
    }
}


// Shows or hides the filter dropdown panel.
// Separate open and close functions exist so other code can force-close it
// (e.g. when the user clicks outside or applies filters).
function toggleFilterDropdown() {
    document.getElementById('filterDropdown')?.classList.toggle('show');
}

function closeFilterDropdown() {
    document.getElementById('filterDropdown')?.classList.remove('show');
}


// Reads the current filter selections and narrows the displayed players to those who match.
// Reads from custom-select data-value attributes instead of native <select> values.
// No input. Calls renderPlayers with the filtered result.
function applyFilters() {
    const ageFilter      = document.getElementById('filterAge')?.dataset.value      || 'all';
    const gameFilter     = document.getElementById('filterGames')?.dataset.value    || 'all';
    const locationFilter = document.getElementById('filterLocation')?.dataset.value || 'all';

    let filteredPlayers = getVisiblePlayers();

    if (gameFilter !== 'all') {
        filteredPlayers = filteredPlayers.filter(player =>
            player.games.some(game => game.toLowerCase() === gameFilter.toLowerCase())
        );
    }

    if (ageFilter === '18-25') {
        filteredPlayers = filteredPlayers.filter(p => p.age >= 18 && p.age <= 25);
    } else if (ageFilter === '26-35') {
        filteredPlayers = filteredPlayers.filter(p => p.age >= 26 && p.age <= 35);
    } else if (ageFilter === '35+') {
        filteredPlayers = filteredPlayers.filter(p => p.age >= 35);
    }

    if (locationFilter !== 'all') {
        filteredPlayers = filteredPlayers.filter(p => p.location === locationFilter);
    }

    renderPlayers(filteredPlayers);
    closeFilterDropdown();
}

// Counts players per location and updates the badge spans in the location dropdown.
function updateLocationCounts() {
    const counts = { all: PLAYERS.length, malmo: 0, goteborg: 0, stockholm: 0 };
    PLAYERS.forEach(p => { if (counts[p.location] !== undefined) counts[p.location]++; });
    Object.entries(counts).forEach(([loc, n]) => {
        const el = document.getElementById(`cnt-${loc}`);
        if (el) el.textContent = n;
    });
}

// Initialises the custom-select components — handles open/close, option selection,
// and closes all dropdowns when clicking outside.
function initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(sel => {
        const trigger = sel.querySelector('.custom-select-trigger');
        const options = sel.querySelectorAll('.custom-select-option');
        const label   = sel.querySelector('.custom-select-label');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = sel.classList.contains('open');
            // Close all other selects first
            document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
            if (!isOpen) sel.classList.add('open');
        });

        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                options.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                sel.dataset.value = opt.dataset.value;
                // Label text = first text node inside option (ignores count badge)
                label.textContent = opt.querySelector('span:first-child')?.textContent || opt.textContent.trim();
                sel.classList.remove('open');
            });
        });
    });

    // Click anywhere outside closes all open custom selects
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    });
}


// Wires up all the interactive elements once the DOM is ready.
// Kept in DOMContentLoaded so none of this runs before the HTML elements exist.
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('hamburgerBtn')?.addEventListener('click', toggleMenu);
    document.getElementById('menuCloseBtn')?.addEventListener('click', closeMenu);
    document.getElementById('menuOverlay')?.addEventListener('click', closeMenu);
    
    document.querySelectorAll('.menu-items li').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();   // prevent the click from bubbling up and closing things it shouldn't
            const page = item.getAttribute('data-page');
            if (page) handleMenuClick(page);
        });
    });
    
    document.getElementById('filterToggleBtn')?.addEventListener('click', toggleFilterDropdown);
    document.getElementById('applyFilters')?.addEventListener('click', applyFilters);
    
    // Close the filter dropdown if the user clicks anywhere outside of it.
    document.addEventListener('click', (e) => {
        const filterSection = document.querySelector('.filter-section');
        const dropdown = document.getElementById('filterDropdown');
        if (filterSection && dropdown && !filterSection.contains(e.target) && dropdown.classList.contains('show')) {
            closeFilterDropdown();
        }
    });
    
    // Profile picture click: if logged in, open profile; if not, prompt to log in first.
    const profilePic = document.getElementById('profilePic');
    if (profilePic) {
        profilePic.addEventListener('click', () => {
            if (isLoggedIn) {
                openModalPage('profile/profile.html');
            } else {
                alert('Please login first to view your profile');
                openModalPage('login/login.html');
            }
        });
    }
    
    updateLoginLogoutButton();
    checkSession();
    initEventSystem();
    initCustomSelects();
    updateLocationCounts();
});


// ============================================================
// EVENT SYSTEM
// Lets logged-in users post a gaming event that appears as a
// pulsing ring on the map behind their player marker.
// Other users can click the marker to see the event popup.
// ============================================================

// Active events in memory. Each entry: { playerId, eventName, gameName, startHour, startMin, startAmPm, endHour, endMin, endAmPm, hasEnd }
let activeEvents = [
    // Two demo events pre-loaded so the map isn't empty on first visit.
    { playerId: 1, eventName: 'Friday Ranked Grind', gameName: 'Valorant', startHour: 8, startMin: 0, startAmPm: 'PM', hasEnd: false },
    { playerId: 6, eventName: 'CS2 5v5 Scrim',       gameName: 'CS2',      startHour: 9, startMin: 30, startAmPm: 'PM', hasEnd: true, endHour: 11, endMin: 0, endAmPm: 'PM' }
];

// MapLibre marker objects for the pulse rings, keyed by playerId.
const pulseMarkers = {};

// The currently open event popup, if any.
let activeEventPopup = null;


// Builds a scroll drum showing exactly 3 rows: one above, selected in center, one below.
// Infinite wrapping for hours/minutes. Returns { el, getValue }.
function buildDrum(items, initialIndex = 0) {
    const ITEM_H = 42;   // px per row
    const VISIBLE = 3;   // rows shown: prev · selected · next
    const CENTER  = 1;   // index of the center row (0-based)

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position: relative;
        height: ${ITEM_H * VISIBLE}px;
        overflow: hidden;
        cursor: grab;
        user-select: none;
        width: 100%;
    `;

    // Soft fade at top and bottom edges
    wrapper.style.webkitMaskImage = 'linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)';
    wrapper.style.maskImage       = 'linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)';

    const track = document.createElement('div');
    track.style.cssText = 'position:absolute;width:100%;will-change:transform;';

    // Triple so wrapping stays seamless across boundaries
    const tripled = [...items, ...items, ...items];
    tripled.forEach(label => {
        const el = document.createElement('div');
        el.className = 'drum-item';
        el.textContent = label;
        el.style.cssText = `
            height:${ITEM_H}px;
            line-height:${ITEM_H}px;
            text-align:center;
            font-size:18px;
            font-weight:700;
            color:#555;
            transition:color 0.12s,font-size 0.12s;
        `;
        track.appendChild(el);
    });
    wrapper.appendChild(track);

    // Green selection bar behind the center row
    const bar = document.createElement('div');
    bar.style.cssText = `
        position:absolute;
        top:${ITEM_H * CENTER}px;
        left:2px; right:2px;
        height:${ITEM_H}px;
        border:1.5px solid rgba(57,217,138,0.55);
        border-radius:8px;
        background:rgba(57,217,138,0.08);
        pointer-events:none;
    `;
    wrapper.appendChild(bar);

    // Start in the middle copy so we have room to scroll both ways
    let cur = items.length + initialIndex;

    function paint(idx) {
        track.querySelectorAll('.drum-item').forEach((el, i) => {
            const d = Math.abs(i - idx);
            if (d === 0) { el.style.color = '#39d98a'; el.style.fontSize = '20px'; }
            else if (d === 1) { el.style.color = '#999';    el.style.fontSize = '14px'; }
            else              { el.style.color = 'transparent'; el.style.fontSize = '12px'; }
        });
    }

    function snap(idx, animate) {
        track.style.transition = animate
            ? 'transform 0.18s cubic-bezier(0.25,0.46,0.45,0.94)'
            : 'none';
        track.style.transform = `translateY(${-(idx - CENTER) * ITEM_H}px)`;
        paint(idx);
    }

    function normalize() {
        if (cur < items.length)           { cur += items.length; snap(cur, false); }
        else if (cur >= items.length * 2) { cur -= items.length; snap(cur, false); }
    }

    snap(cur, false);

    // ── Drag ──────────────────────────────────────────────────
    let startY = 0, startCur = 0, dragging = false;

    wrapper.addEventListener('mousedown',  e => { dragging = true; startY = e.clientY; startCur = cur; wrapper.style.cursor = 'grabbing'; });
    wrapper.addEventListener('touchstart', e => { dragging = true; startY = e.touches[0].clientY; startCur = cur; }, { passive: true });

    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const d = Math.round((startY - e.clientY) / ITEM_H);
        cur = startCur + d;
        snap(cur, false);
    });
    window.addEventListener('touchmove', e => {
        if (!dragging) return;
        const d = Math.round((startY - e.touches[0].clientY) / ITEM_H);
        cur = startCur + d;
        snap(cur, false);
    }, { passive: true });

    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        wrapper.style.cursor = 'grab';
        snap(cur, true);
        setTimeout(normalize, 200);
    };
    window.addEventListener('mouseup',  endDrag);
    window.addEventListener('touchend', endDrag);

    // Scroll wheel
    wrapper.addEventListener('wheel', e => {
        e.preventDefault();
        cur += e.deltaY > 0 ? 1 : -1;
        snap(cur, true);
        setTimeout(normalize, 220);
    }, { passive: false });

    return {
        el: wrapper,
        getValue: () => items[((cur - items.length) % items.length + items.length) % items.length]
    };
}

// Builds the AM/PM toggle — just two clickable labels, no drum.
// Returns { el, getValue }.
function buildAmPmToggle(initial = 'PM') {
    let value = initial;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
        display:flex;
        flex-direction:column;
        gap:4px;
        align-items:center;
        justify-content:center;
    `;

    ['AM','PM'].forEach(label => {
        const btn = document.createElement('div');
        btn.textContent = label;
        btn.dataset.val = label;
        const isSelected = label === initial;
        btn.style.cssText = `
            width:48px; height:40px;
            display:flex; align-items:center; justify-content:center;
            border-radius:8px;
            font-size:14px; font-weight:800;
            cursor:pointer;
            transition:all 0.15s;
            ${isSelected
                ? 'background:rgba(57,217,138,0.18);border:1.5px solid rgba(57,217,138,0.6);color:#39d98a;'
                : 'background:transparent;border:1.5px solid transparent;color:#555;'}
        `;
        btn.addEventListener('click', () => {
            value = label;
            wrap.querySelectorAll('div').forEach(b => {
                const sel = b.dataset.val === value;
                b.style.background = sel ? 'rgba(57,217,138,0.18)' : 'transparent';
                b.style.border     = sel ? '1.5px solid rgba(57,217,138,0.6)' : '1.5px solid transparent';
                b.style.color      = sel ? '#39d98a' : '#555';
            });
        });
        wrap.appendChild(btn);
    });

    return { el: wrap, getValue: () => value };
}

// Builds a complete time picker: hour drum | : | minute drum | divider | AM/PM toggle.
// Returns { el, getHour, getMin, getAmPm }.
function buildTimePicker(initH = 8, initM = 0, initAmPm = 'PM') {
    const hours   = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    const minutes = ['00','05','10','15','20','25','30','35','40','45','50','55'];

    const hIdx = hours.indexOf(String(initH));
    const mStr = String(initM).padStart(2,'0');
    const mIdx = minutes.includes(mStr) ? minutes.indexOf(mStr) : 0;

    const hourDrum  = buildDrum(hours,   hIdx >= 0 ? hIdx : 7);
    const minDrum   = buildDrum(minutes, mIdx);
    const ampmToggle = buildAmPmToggle(initAmPm);

    const container = document.createElement('div');
    container.style.cssText = `
        display:flex;
        align-items:center;
        gap:0;
        background:rgba(10,11,14,0.75);
        border:1px solid rgba(57,217,138,0.25);
        border-radius:14px;
        padding:8px 10px;
    `;

    hourDrum.el.style.width = '44px';
    minDrum.el.style.width  = '44px';

    const colon = document.createElement('div');
    colon.textContent = ':';
    colon.style.cssText = 'color:#39d98a;font-size:22px;font-weight:800;padding:0 4px;line-height:1;';

    const divider = document.createElement('div');
    divider.style.cssText = 'width:1px;height:80px;background:rgba(57,217,138,0.2);margin:0 10px;';

    container.appendChild(hourDrum.el);
    container.appendChild(colon);
    container.appendChild(minDrum.el);
    container.appendChild(divider);
    container.appendChild(ampmToggle.el);

    return {
        el:       container,
        getHour:  () => parseInt(hourDrum.getValue()),
        getMin:   () => parseInt(minDrum.getValue()),
        getAmPm:  () => ampmToggle.getValue()
    };
}


// Injects the event form overlay and the + button into the map area.
// Called once on DOMContentLoaded.
function initEventSystem() {
    const mapArea = document.querySelector('.map-area');
    if (!mapArea) return;

    // ── + button ──────────────────────────────────────────────
    const addBtn = document.createElement('button');
    addBtn.className = 'event-add-btn';
    addBtn.innerHTML = '+';
    addBtn.title = 'Add Event';
    mapArea.appendChild(addBtn);

    // ── Form overlay ──────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'event-form-overlay';
    overlay.id = 'eventFormOverlay';

    overlay.innerHTML = `
        <div class="event-form-card">
            <button class="event-form-close" id="eventFormClose">✕</button>
            <div class="event-form-title">Create Event</div>
            <div class="event-form-subtitle">Let nearby players find and join you</div>
            <div class="event-form-error" id="eventFormError"></div>

            <div class="event-field">
                <label>Event Name</label>
                <input class="event-input" id="evtName" type="text" placeholder="e.g. Friday Ranked Grind">
            </div>
            <div class="event-field">
                <label>Game</label>
                <input class="event-input" id="evtGame" type="text" placeholder="e.g. Valorant, CS2, Minecraft">
            </div>
            <div class="event-field">
                <label>Start Time</label>
                <div id="evtStartPicker"></div>
            </div>
            <div class="event-field">
                <label>End Time <span class="event-label-note">(optional)</span></label>
                <div id="evtEndPicker"></div>
                <p class="event-field-note">Leave end time unchanged and the event auto-closes after 2 hours.</p>
            </div>
            <button class="event-submit-btn" id="eventSubmitBtn">Start Event</button>
        </div>
    `;
    mapArea.appendChild(overlay);

    // ── Helpers ───────────────────────────────────────────────
    // Convert 12-hour + AM/PM to minutes-since-midnight for comparison.
    function to24mins(h, m, ap) {
        let hour = h % 12;
        if (ap === 'PM') hour += 12;
        return hour * 60 + m;
    }

    // Snap to current local time, rounding UP to the nearest 5-minute slot.
    function nowRounded() {
        const now  = new Date();
        let   h    = now.getHours();
        let   m    = Math.ceil(now.getMinutes() / 5) * 5;
        if (m === 60) { m = 0; h = (h + 1) % 24; }
        const ap   = h >= 12 ? 'PM' : 'AM';
        const h12  = h % 12 || 12;
        return { h12, m, ap, totalMins: h * 60 + m };
    }

    // Build pickers seeded with current local time
    const seed       = nowRounded();
    const endSeedH   = seed.totalMins + 120 >= 1440
        ? { h12: ((seed.totalMins + 120) % 1440) < 720
                ? ((seed.totalMins + 120) % 1440 === 0 ? 12 : Math.floor(((seed.totalMins + 120) % 1440) / 60) || 12)
                : Math.floor(((seed.totalMins + 120) % 1440) / 60) % 12 || 12,
            ap: ((seed.totalMins + 120) % 1440) >= 720 ? 'PM' : 'AM' }
        : { h12: (seed.h12 === 10 && seed.ap === seed.ap) ? seed.h12 + 2 > 12 ? seed.h12 - 10 : seed.h12 + 2 : ((seed.totalMins + 120) % 1440 < 720 ? Math.floor((seed.totalMins + 120) / 60) % 12 || 12 : Math.floor((seed.totalMins + 120) / 60) % 12 || 12),
            ap: (seed.totalMins + 120) >= 720 && (seed.totalMins + 120) < 1440 ? 'PM' : seed.totalMins + 120 >= 1440 ? (((seed.totalMins + 120) % 1440) >= 720 ? 'PM' : 'AM') : 'AM' };

    // Simpler end-time calculation: just add 2 hours to seed
    function addMins(totalMins, add) {
        const t   = (totalMins + add) % 1440;
        const h24 = Math.floor(t / 60);
        const m   = t % 60;
        return { h12: h24 % 12 || 12, m, ap: h24 >= 12 ? 'PM' : 'AM' };
    }
    const endSeed = addMins(seed.totalMins, 120);

    // Round end minutes to nearest 5
    const endMrounded = Math.round(endSeed.m / 5) * 5 % 60;

    const startPicker = buildTimePicker(seed.h12, seed.m, seed.ap);
    const endPicker   = buildTimePicker(endSeed.h12, endMrounded, endSeed.ap);
    document.getElementById('evtStartPicker').appendChild(startPicker.el);
    document.getElementById('evtEndPicker').appendChild(endPicker.el);

    // ── Open / close ──────────────────────────────────────────
    addBtn.addEventListener('click', () => {
        if (!isLoggedIn) {
            alert('Please login first to create an event');
            openModalPage('login/login.html');
            return;
        }
        overlay.classList.add('show');
    });

    document.getElementById('eventFormClose').addEventListener('click', () => {
        overlay.classList.remove('show');
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('show');
    });

    // ── Submit ────────────────────────────────────────────────
    document.getElementById('eventSubmitBtn').addEventListener('click', () => {
        const name  = document.getElementById('evtName').value.trim();
        const game  = document.getElementById('evtGame').value.trim();
        const errEl = document.getElementById('eventFormError');

        if (!name || !game) {
            errEl.textContent = 'Please fill in both Event Name and Game.';
            errEl.style.display = 'block';
            return;
        }

        // Validate: start time must not be in the past
        const startH  = startPicker.getHour();
        const startM  = startPicker.getMin();
        const startAp = startPicker.getAmPm();
        const endH    = endPicker.getHour();
        const endM    = endPicker.getMin();
        const endAp   = endPicker.getAmPm();

        const nowMins   = new Date().getHours() * 60 + new Date().getMinutes();
        const startMins = to24mins(startH, startM, startAp);

        if (startMins < nowMins) {
            errEl.textContent = `Start time ${startH}:${String(startM).padStart(2,'0')} ${startAp} is already in the past. Please choose a future time.`;
            errEl.style.display = 'block';
            return;
        }

        // Validate: end time must be after start time (if set)
        const endMins = to24mins(endH, endM, endAp);
        if (endMins !== to24mins(endSeed.h12, endMrounded, endSeed.ap) && endMins <= startMins) {
            errEl.textContent = 'End time must be after the start time.';
            errEl.style.display = 'block';
            return;
        }

        errEl.style.display = 'none';

        // Check if end time differs from its seed (user changed it)
        const hasEnd = !(endH === endSeed.h12 && endM === endMrounded && endAp === endSeed.ap);

        // Attach event to the logged-in demo player
        const demoPlayer = PLAYERS.find(p => p.isDemo);
        const demoPlayerId = demoPlayer ? demoPlayer.id : 99;
        activeEvents = activeEvents.filter(e => e.playerId !== demoPlayerId);
        activeEvents.push({
            playerId: demoPlayerId, eventName: name, gameName: game,
            startHour: startH, startMin: startM, startAmPm: startAp,
            hasEnd, endHour: endH, endMin: endM, endAmPm: endAp
        });

        overlay.classList.remove('show');
        document.getElementById('evtName').value = '';
        document.getElementById('evtGame').value = '';
        refreshEventMarkers();
    });

    // Draw initial pulse markers for the demo events
    map.on('load', () => {
        // Small delay to ensure the players layer is ready
        setTimeout(refreshEventMarkers, 500);
    });
    // If map already loaded
    if (map.loaded()) setTimeout(refreshEventMarkers, 300);
}


// Formats a time object into a readable string like "8:00 PM".
function fmtTime(h, m, ap) {
    return `${h}:${String(m).padStart(2,'0')} ${ap}`;
}


// Removes all existing pulse rings and redraws them.
// Pulse rings are injected INTO the avatar marker element so they always
// stay perfectly centered behind the avatar on zoom and pan.
function refreshEventMarkers() {
    // Clear old rings from all avatar elements
    Object.values(playerMarkers).forEach(({ el }) => {
        el.querySelectorAll('.pulse-ring').forEach(r => r.remove());
    });
    // Also remove any stale standalone pulse markers (legacy cleanup)
    Object.values(pulseMarkers).forEach(m => { try { m.remove(); } catch(e){} });
    Object.keys(pulseMarkers).forEach(k => delete pulseMarkers[k]);

    activeEvents.forEach(evt => {
        const player = PLAYERS.find(p => p.id === evt.playerId);
        if (!player) return;

        const markerData = playerMarkers[player.id];
        if (!markerData) return; // player not visible on map

        // Inject three expanding rings into the avatar element (behind the img via z-index)
        ['', 'delay1', 'delay2'].forEach(cls => {
            const ring = document.createElement('div');
            ring.className = 'pulse-ring' + (cls ? ' ' + cls : '');
            markerData.el.insertBefore(ring, markerData.el.firstChild);
        });

        // Store a reference so we know this player has an event (used for cleanup)
        pulseMarkers[player.id] = { remove: () => {
            if (playerMarkers[player.id]) {
                playerMarkers[player.id].el.querySelectorAll('.pulse-ring').forEach(r => r.remove());
            }
        }};
    });
}


// Tracks the active mini-profile popup
let activeMiniPopup = null;

// Closes any open map popup (event or mini-profile)
function closeAllPopups() {
    if (activeEventPopup) { activeEventPopup.remove(); activeEventPopup = null; }
    if (activeMiniPopup)  { activeMiniPopup.remove();  activeMiniPopup  = null; }
}

// Shows the GREEN event popup — first click on an event player.
// Gamertag is a clickable link that opens the full profile modal.
function showEventPopup(player, evt) {
    closeAllPopups();

    const timeStr   = fmtTime(evt.startHour, evt.startMin, evt.startAmPm);
    const endStr    = evt.hasEnd ? ` – ${fmtTime(evt.endHour, evt.endMin, evt.endAmPm)}` : ' · 2hr';
    const avatarSrc = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.avatarSeed || player.gamertag)}`;
    const statusColor = { active: '#39d98a', recent: '#f5a623', offline: '#6c6f78' }[player.status] || '#6c6f78';

    const popupHtml = `
        <div class="event-popup-inner">
            <div class="event-popup-header">
                <img src="${avatarSrc}" class="event-popup-avatar" alt="${player.gamertag}">
                <div>
                    <a href="#" class="event-name-link" onclick="window._openProfileFromPopup(${player.id}); return false;">${player.gamertag}</a>
                    <div class="event-popup-status" style="color:${statusColor}">&#9679; Live Event</div>
                </div>
                <span class="event-popup-badge">LIVE</span>
            </div>
            <div class="event-popup-divider"></div>
            <div class="event-popup-row">
                <span class="event-popup-label">Game</span>
                <span class="event-popup-value">${evt.gameName}</span>
            </div>
            <div class="event-popup-row">
                <span class="event-popup-label">Event</span>
                <span class="event-popup-value">${evt.eventName}</span>
            </div>
            <div class="event-popup-row">
                <span class="event-popup-label">Time</span>
                <span class="event-popup-value">${timeStr}${endStr}</span>
            </div>
            <button class="event-popup-chat" onclick="window.location.href='chat/chat.html'">Chat Now</button>
        </div>
    `;

    activeEventPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -20], maxWidth: '300px' })
        .setLngLat([player.lng, player.lat])
        .setHTML(popupHtml)
        .addClassName('event-map-popup')
        .addTo(map);
}

// Exposes openPlayerModal to the event popup's inline onclick
window._openProfileFromPopup = function(playerId) {
    const player = PLAYERS.find(p => p.id === playerId);
    if (player) { closeAllPopups(); openPlayerModal(player); }
};

// Shows the DARK-BLUE mini profile popup — first click on a regular player.
// "View Full Profile" button opens the full modal.
function showMiniProfile(player) {
    closeAllPopups();

    const statusColor = { active: '#39d98a', recent: '#f5a623', offline: '#6c6f78' }[player.status] || '#6c6f78';
    const statusLabel = { active: 'Active now', recent: `Active ${player.lastActive}`, offline: 'Offline' }[player.status];
    const gamesStr    = (player.games || []).join(' · ');
    const initials    = player.gamertag.slice(0, 2).toUpperCase();

    const popupHtml = `
        <div class="mini-profile-inner">
            <div class="mini-profile-header">
                <div class="mini-profile-avatar">${initials}</div>
                <div>
                    <div class="mini-profile-name">${player.gamertag}</div>
                    <div class="mini-profile-status" style="color:${statusColor}">&#9679; ${statusLabel}</div>
                </div>
            </div>
            <div class="mini-profile-divider"></div>
            <div class="mini-profile-row">
                <span class="mini-profile-label">Rank</span>
                <span class="mini-profile-value">${player.rank}</span>
            </div>
            <div class="mini-profile-row">
                <span class="mini-profile-label">Age</span>
                <span class="mini-profile-value">${player.age}</span>
            </div>
            <div class="mini-profile-divider"></div>
            <div class="mini-profile-games">${gamesStr}</div>
            <button class="mini-profile-btn" onclick="window._openFullProfile(${player.id})">View Full Profile</button>
        </div>
    `;

    activeMiniPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -20], maxWidth: '300px' })
        .setLngLat([player.lng, player.lat])
        .setHTML(popupHtml)
        .addClassName('mini-profile-popup')
        .addTo(map);

    // Inject mini-profile styles once
    if (!document.getElementById('mini-profile-styles')) {
        const s = document.createElement('style');
        s.id = 'mini-profile-styles';
        s.textContent = `
            .mini-profile-popup .maplibregl-popup-content {
                background: #0f1923 !important;
                border: 1.5px solid rgba(96, 165, 250, 0.5) !important;
                border-radius: 10px !important;
                padding: 20px 22px 18px 22px !important;
                box-shadow: 0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(96,165,250,0.05) !important;
                min-width: 260px;
            }
            .mini-profile-popup .maplibregl-popup-tip {
                border-top-color: rgba(96, 165, 250, 0.5) !important;
            }
            .mini-profile-popup .maplibregl-popup-close-button { display: none !important; }
            .mini-profile-inner { display: flex; flex-direction: column; gap: 12px; }
            .mini-profile-header { display: flex; align-items: center; gap: 14px; }
            .mini-profile-avatar {
                width: 50px; height: 50px; border-radius: 8px;
                background: linear-gradient(135deg, #1e3a5f, #2563eb);
                border: 1.5px solid rgba(96,165,250,0.4);
                display: flex; align-items: center; justify-content: center;
                font-size: 18px; font-weight: 800; color: #e0f2fe;
                flex-shrink: 0; letter-spacing: 1px;
            }
            .mini-profile-name {
                font-size: 17px; font-weight: 800; color: #f0f9ff;
                font-family: 'Orbitron', sans-serif; letter-spacing: 0.5px;
                line-height: 1.2;
            }
            .mini-profile-status { font-size: 12px; margin-top: 3px; font-weight: 700; letter-spacing: 0.3px; }
            .mini-profile-divider { height: 1px; background: rgba(96,165,250,0.15); margin: 0 -2px; }
            .mini-profile-row { display: flex; justify-content: space-between; align-items: center; }
            .mini-profile-label { font-size: 10px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 1px; }
            .mini-profile-value { font-size: 13px; color: #e0f2fe; font-weight: 600; }
            .mini-profile-games { font-size: 12px; color: #94a3b8; font-weight: 500; }
            .mini-profile-btn {
                width: 100%;
                background: #1d4ed8;
                border: none; color: #e0f2fe;
                padding: 11px 14px; border-radius: 6px;
                font-size: 13px; font-weight: 800; cursor: pointer;
                margin-top: 2px; transition: all 0.2s;
                text-transform: uppercase; letter-spacing: 1px;
                font-family: inherit;
            }
            .mini-profile-btn:hover { background: #2563eb; box-shadow: 0 4px 14px rgba(37,99,235,0.5); }
            .event-name-link { color: #f0f9ff; text-decoration: none; font-size:16px; font-weight:800; font-family:'Orbitron',sans-serif; transition: color 0.15s; }
            .event-name-link:hover { color: #39d98a; }
            .event-popup-header { display:flex; align-items:center; gap:10px; }
            .event-popup-avatar { width:46px; height:46px; border-radius:50%; border:2px solid rgba(57,217,138,0.5); flex-shrink:0; }
            .event-popup-status { font-size:11px; font-weight:600; margin-top:2px; }
            .event-popup-badge { margin-left:auto; background:rgba(57,217,138,0.15); border:1px solid rgba(57,217,138,0.5); color:#39d98a; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:1px; padding:2px 7px; border-radius:20px; white-space:nowrap; }
            .event-popup-divider { height:1px; background:rgba(57,217,138,0.15); margin:10px -2px; }
            .event-popup-row { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
            .event-popup-label { font-size:10px; font-weight:700; color:#39d98a; text-transform:uppercase; letter-spacing:1px; }
            .event-popup-value { font-size:12px; color:#e0f2fe; font-weight:600; text-align:right; max-width:160px; }
            .event-map-popup .maplibregl-popup-close-button { display: none !important; }
        `;
        document.head.appendChild(s);
    }
}

window._openFullProfile = function(playerId) {
    const player = PLAYERS.find(p => p.id === playerId);
    if (player) { closeAllPopups(); openPlayerModal(player); }
};