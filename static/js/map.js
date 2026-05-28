// map.js GameScape map page
// Main map page with avatar markers, events and profile popups.

const MAPTILER_KEY   = window.MAPTILER_KEY || '';
const MAPTILER_STYLE = `https://api.maptiler.com/maps/019d1f6a-0bb2-7db3-a9c7-670e85ac0f84/style.json?key=${MAPTILER_KEY}`;

// Hardcoded demo players. Each has avatarSeed (DiceBear), location (for filter),
// mapVisible flag, and isDemo (marks the logged-in user's stand-in marker).
const PLAYERS = [
    { id: 1,  gamertag: 'NightOwl_SE',   games: ['Valorant', 'CS2'],            rank: 'Diamond',    status: 'active',  lng: 13.002, lat: 55.607, lastActive: 'Just now',   age: 24, location: 'malmo',     avatarSeed: 'nightowl',    mapVisible: true },
    { id: 2,  gamertag: 'ProPlayer_99',  games: ['Minecraft', 'Fortnite'],       rank: 'Gold',       status: 'recent',  lng: 13.018, lat: 55.612, lastActive: '12 min ago',  age: 19, location: 'malmo',     avatarSeed: 'proplayer',   mapVisible: true },
    { id: 3,  gamertag: 'ZeroGrav',      games: ['League of Legends'],           rank: 'Platinum',   status: 'active',  lng: 12.995, lat: 55.598, lastActive: 'Just now',   age: 28, location: 'goteborg',  avatarSeed: 'zerograv',    mapVisible: true },
    { id: 4,  gamertag: 'StealthMode_K', games: ['Valorant', 'Apex Legends'],    rank: 'Challenger', status: 'active',  lng: 13.010, lat: 55.615, lastActive: 'Just now',   age: 22, location: 'stockholm', avatarSeed: 'stealth',     mapVisible: true },
    { id: 5,  gamertag: 'CasualGamer88', games: ['Minecraft'],                   rank: 'Unranked',   status: 'recent',  lng: 13.025, lat: 55.595, lastActive: '1 hour ago', age: 31, location: 'goteborg',  avatarSeed: 'casualgamer', mapVisible: true },
    { id: 6,  gamertag: 'SniperWolf',    games: ['CS2', 'Valorant'],             rank: 'Master',     status: 'active',  lng: 13.005, lat: 55.600, lastActive: 'Just now',   age: 26, location: 'malmo',     avatarSeed: 'sniperwolf',  mapVisible: true },
    { id: 7,  gamertag: 'NoobMaster69',  games: ['Fortnite'],                    rank: 'Silver',     status: 'offline', lng: 13.015, lat: 55.620, lastActive: '2 days ago', age: 17, location: 'stockholm', avatarSeed: 'noobmaster',  mapVisible: true },
    // Demo player represents the logged-in user on the map
    { id: 99, gamertag: 'Demo',          games: ['Valorant', 'CS2', 'Fortnite'], rank: 'Gold',       status: 'active',  lng: 13.008, lat: 55.603, lastActive: 'Just now',   age: 22, location: 'malmo',     avatarSeed: 'GameScape',   mapVisible: true, isDemo: true },
];

//  Demo visibility (eye icon in profile page) 
// Persisted in localStorage so the preference survives page refresh.
const DEMO_VISIBLE_KEY = 'gamescape_demo_visible';

function getDemoVisible() {
    const v = localStorage.getItem(DEMO_VISIBLE_KEY);
    return v === null ? true : v === 'true';
}

window.livePlayers = null;

window.currentPlayersForMap = function() {
    return window.livePlayers || getVisiblePlayers();
};

// Called by profile.js (inside iframe) via window.setDemoVisible().
function setDemoVisible(val) {
    localStorage.setItem(DEMO_VISIBLE_KEY, String(val));
    const demo = PLAYERS.find(p => p.isDemo);
    if (demo) demo.mapVisible = val;
    renderMapMarkers(window.currentPlayersForMap());
    refreshEventMarkers();
}
// Apply persisted visibility on load
PLAYERS.find(p => p.isDemo).mapVisible = getDemoVisible();

// Expose so profile iframe can call it
window.setDemoVisible = setDemoVisible;

function getVisiblePlayers() {
    return PLAYERS.filter(p => p.mapVisible);
}


//  Map initialisation 

const map = new maplibregl.Map({
    container: 'map',
    style:     MAPTILER_STYLE,
    center:    [13.008, 55.605],
    zoom:      13,
    antialias: true
});

map.addControl(new maplibregl.NavigationControl({
    showCompass: true, showZoom: true, visualizePitch: true
}), 'bottom-right');

// Global login state updated by setLoggedIn() and checkSession()
let isLoggedIn      = false;
let currentUsername = null;
let currentAvatarSeed = null;
let mapSocket = null;

function dicebearAvatar(seed) {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed || 'GameScape')}`;
}

function displayGameName(game) {
    return typeof game === 'string' ? game : (game && game.name ? game.name : 'Game');
}

async function mapFriendAction(action, username) {
    let url = '/api/friends/request';
    let method = 'POST';
    if (action === 'accept') url = '/api/friends/accept';
    if (action === 'ignore') url = '/api/friends/ignore';
    if (action === 'remove') { url = `/api/friends/${encodeURIComponent(username)}`; method = 'DELETE'; }
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (method !== 'DELETE') options.body = JSON.stringify({ username });
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || 'Friend action failed');
    await loadLivePlayers();
}

function mapFriendActions(player) {
    if (!isLoggedIn || player.isDemo || player.is_self || player.gamertag === currentUsername) return '';
    const state = player.friendship_status || 'none';
    if (state === 'friends') return `<button class="mini-profile-btn friend-action-btn" onclick="window.location.href='/chat'">Chat</button><button class="mini-profile-btn friend-action-btn muted" onclick="window._mapFriendAction('remove','${player.gamertag}')">Remove Friend</button>`;
    if (state === 'incoming') return `<button class="mini-profile-btn friend-action-btn" onclick="window._mapFriendAction('accept','${player.gamertag}')">Accept Friend</button><button class="mini-profile-btn friend-action-btn muted" onclick="window._mapFriendAction('ignore','${player.gamertag}')">Ignore</button>`;
    if (state === 'outgoing') return `<button class="mini-profile-btn friend-action-btn muted" disabled>Pending Request</button>`;
    return `<button class="mini-profile-btn friend-action-btn" onclick="window._mapFriendAction('add','${player.gamertag}')">Add Friend</button>`;
}

window._mapFriendAction = async function(action, username) {
    try { await mapFriendAction(action, username); closeAllPopups(); }
    catch (e) { alert(e.message); }
};

function refreshPlayerAvatar(player) {
    const marker = playerMarkers[player.id];
    const src = dicebearAvatar(player.avatarSeed || player.gamertag);
    if (marker) marker.el.querySelector('img')?.setAttribute('src', src);
}



// Updates global login state and refreshes the avatar + menu button text.
// Also updates the demo player's gamertag to match the logged-in user.
function setLoggedIn(status, username, avatarSeed) {
    isLoggedIn      = status;
    currentUsername = username || null;
    currentAvatarSeed = avatarSeed || username || null;
    updateLoginLogoutButton();

    const avatarImg = document.querySelector('.avatar-img');
    if (avatarImg && username) {
        avatarImg.src = dicebearAvatar(currentAvatarSeed);
        avatarImg.alt = username;
    }

    // Make the demo marker represent the real logged-in user's gamertag/avatar.
    if (status && username) {
        const demo = PLAYERS.find(p => p.isDemo);
        if (demo) { demo.gamertag = username; demo.avatarSeed = currentAvatarSeed; refreshPlayerAvatar(demo); }
        renderMapMarkers(getVisiblePlayers());
        sendMapPresence().then(() => {
            connectMapSocket();
            loadLivePlayers();
        });
    }
}

// Checks the server session on page load so a refreshed page stays logged in.
async function checkSession() {
    try {
        const res  = await fetch('/api/me', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.logged_in) setLoggedIn(true, data.username, data.avatar_seed);
    } catch (e) { console.warn('Session check failed:', e); }
}

// Server picks the IP location and keeps one randomized position for this login session.
async function sendMapPresence() {
    if (!isLoggedIn) return;
    try {
        const res = await fetch('/api/map/presence', { method: 'POST', credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        const demo = PLAYERS.find(p => p.isDemo);
        if (data.success && demo && data.lat != null && data.lng != null) {
            demo.lat = Number(data.lat);
            demo.lng = Number(data.lng);
            renderMapMarkers(getVisiblePlayers());
        } else if (data.error) console.warn('Map presence failed:', data.error);
    } catch (e) { console.warn('Map presence failed:', e); }
}

// Keeps the map updated when other users move or come online.
function connectMapSocket() {
    if (mapSocket || !window.WebSocket) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    mapSocket = new WebSocket(`${protocol}://${location.host}/ws/map`);
    mapSocket.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (!msg.type || msg.type === 'players_snapshot') applyLivePlayers(msg.players || []);
    };
    mapSocket.onclose = () => { mapSocket = null; };
}

// Merges server players into the existing demo/player list.
function mergeLivePlayer(player) {
    const existing = PLAYERS.find(p => p.id === player.id);
    const mapped = {
        id: player.id,
        gamertag: player.gamertag || player.username,
        games: player.games || [],
        rank: player.rank || 'Unranked',
        status: player.status || 'offline',
        lng: player.lng,
        lat: player.lat,
        lastActive: player.lastActive || 'Unknown',
        age: player.age || '—',
        location: player.location || 'malmo',
        avatarSeed: player.avatarSeed || player.gamertag || player.username,
        mapVisible: true,
        friendship_status: player.friendship_status || (existing && existing.friendship_status) || 'none',
        is_self: !!player.is_self,
        isLive: true
    };
    if (mapped.gamertag === currentUsername) {
        const demo = PLAYERS.find(p => p.isDemo);
        if (demo) Object.assign(demo, mapped, { id: demo.id, isDemo: true, mapVisible: getDemoVisible() });
        return;
    }
    if (existing) Object.assign(existing, mapped);
    else PLAYERS.push(mapped);
}

function applyLivePlayers(players) {
    const liveIds = new Set();
    const incoming = spreadOverlappingPlayers(players || []);
    incoming.forEach(p => { liveIds.add(p.id); mergeLivePlayer(p); });
    for (let i = PLAYERS.length - 1; i >= 0; i--) {
        if (PLAYERS[i].isLive && !PLAYERS[i].isDemo && !liveIds.has(PLAYERS[i].id)) PLAYERS.splice(i, 1);
    }
    window.livePlayers = PLAYERS.filter(p => p.isLive || p.isDemo);
    renderMapMarkers(window.currentPlayersForMap());
    refreshEventMarkers?.();
}

// Fallback fetch so the map still loads if the socket is late.
async function loadLivePlayers() {
    try {
        const res = await fetch('/api/players', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success) return;
        applyLivePlayers(data.players || []);
    } catch (e) { console.warn('Failed to load live players:', e); }
}


//  Modal helpers 
// Opens any page (login / register / profile) in a centered iframe overlay.
// Opens login, register and profile pages in the modal.

function openModalPage(page) {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) {
        overlay           = document.createElement('div');
        overlay.id        = 'modalOverlay';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closeModalPage);
    }
    let frame = document.getElementById('modalFrame');
    if (!frame) {
        frame           = document.createElement('iframe');
        frame.id        = 'modalFrame';
        frame.className = 'modal-frame';
        document.body.appendChild(frame);
    }
    frame.src = page;
    overlay.classList.add('show');
    frame.classList.add('show');

    function onEsc(e) {
        if (e.key === 'Escape') { closeModalPage(); document.removeEventListener('keydown', onEsc); }
    }
    document.addEventListener('keydown', onEsc);
}

function closeModalPage() {
    document.getElementById('modalOverlay')?.classList.remove('show');
    const frame = document.getElementById('modalFrame');
    if (frame) {
        frame.classList.remove('show');
        setTimeout(() => { if (frame) frame.src = 'about:blank'; }, 300);
    }
}


//  Avatar marker system 
// Each player is represented by a custom HTML element (DiceBear avatar + status dot)
// rather than MapLibre's default circle layer. This allows richer interactions and
// the pulse-ring event animation to be injected directly into the marker element.

const playerMarkers = {}; // playerId → { marker, el }

function ensureMarkerStyles() {
    if (document.getElementById('avatar-marker-styles')) return;
    const s = document.createElement('style');
    s.id = 'avatar-marker-styles';
    s.textContent = `
        /* Zero-size wrapper all children are absolutely centred on the map coordinate */
        .avatar-marker { position:relative; width:0; height:0; cursor:pointer; }
        .avatar-marker img {
            position:absolute; width:40px; height:40px;
            top:-20px; left:-20px;
            border-radius:50%; border:2.5px solid #1e1f22;
            display:block; transition:transform 0.15s; z-index:2;
        }
        .avatar-marker:hover img { transform:scale(1.12); }
        /* Status dot bottom-right corner of the avatar */
        .avatar-marker .status-ring {
            position:absolute; bottom:-20px; right:-20px;
            width:12px; height:12px;
            border-radius:50%; border:2px solid #0e0f12; z-index:3;
            transform:translate(50%,-50%);
        }
        /* Demo player gets a purple border/glow to distinguish themselves */
        .avatar-marker.demo-marker img {
            border-color:#c084fc;
            box-shadow:0 0 10px rgba(192,132,252,0.6);
        }
        /* Event pulse rings sit behind the avatar (z-index:1) */
        .avatar-marker .pulse-ring {
            position:absolute; width:26px; height:26px;
            border-radius:50%; border:2px solid #39d98a;
            top:-13px; left:-13px;
            animation:event-pulse 2.4s ease-out infinite; opacity:0; z-index:1;
        }
        .avatar-marker .pulse-ring.delay1 { animation-delay:0.8s; }
        .avatar-marker .pulse-ring.delay2 { animation-delay:1.6s; }
    `;
    document.head.appendChild(s);
}

// Builds one avatar marker DOM element for a player.
function buildAvatarMarkerEl(player) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-marker' + (player.isDemo ? ' demo-marker' : '');

    const img = document.createElement('img');
    img.src = dicebearAvatar(player.avatarSeed || player.gamertag);
    img.alt = player.gamertag;
    wrap.appendChild(img);

    const dot = document.createElement('div');
    dot.className  = 'status-ring';
    dot.style.background = player.status === 'active' ? '#39d98a' : player.status === 'recent' ? '#f5a623' : '#6c6f78';
    wrap.appendChild(dot);

    // Click: if this player has an active event show the event popup, otherwise mini profile
    wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        const evt = activeEvents.find(ev => ev.playerId === player.id);
        if (evt) showEventPopup(player, evt);
        else     showMiniProfile(player);
    });

    // Hover tooltip
    let hoverPopup = null;
    wrap.addEventListener('mouseenter', () => {
        const label = player.status === 'active' ? 'Active now'
                    : player.status === 'recent' ? `Active ${player.lastActive}` : 'Offline';
        hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: [0, -44] })
            .setLngLat([player.lng, player.lat])
            .setHTML(`<strong>${player.gamertag}</strong><br><span style="font-size:11px;color:#aaa">${label}</span>`)
            .addTo(map);
    });
    wrap.addEventListener('mouseleave', () => { if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; } });

    return wrap;
}

// Renders/updates avatar markers for a given player list.
// This is a lightweight diff we only remove markers that are no longer in the
// list and only add ones that don't already exist. This avoids tearing down and
// recreating every marker on every filter change.
function renderMapMarkers(playerList) {
    ensureMarkerStyles();
    // Remove stale markers
    Object.keys(playerMarkers).forEach(id => {
        if (!playerList.find(p => p.id === parseInt(id))) {
            playerMarkers[id].marker.remove();
            delete playerMarkers[id];
        }
    });
    // Add new markers, and repaint existing marker avatars when their seed changes.
    playerList.forEach(player => {
        if (playerMarkers[player.id]) {
            playerMarkers[player.id].marker.setLngLat([player.lng, player.lat]);
            refreshPlayerAvatar(player);
            const dot = playerMarkers[player.id].el.querySelector('.status-ring');
            if (dot) dot.style.background = player.status === 'active' ? '#39d98a' : player.status === 'recent' ? '#f5a623' : '#6c6f78';
            return;
        }
        const el     = buildAvatarMarkerEl(player);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([player.lng, player.lat])
            .addTo(map);
        playerMarkers[player.id] = { marker, el };
    });
    updatePlayerCount(playerList);
}

map.on('load', () => {
    renderMapMarkers(window.currentPlayersForMap());
    connectMapSocket();
    loadLivePlayers();
});

map.on('error', (e) => {
    console.error('Map error:', e);
});


// Updates the bottom-left player count badge.
function updatePlayerCount(players) {
    const active  = players.filter(p => p.status === 'active').length;
    const countEl = document.getElementById('countText');
    if (countEl) countEl.textContent = `${players.length} players nearby · ${active} active now`;
}

function renderPlayers(playerList) {
    renderMapMarkers(playerList);
}


//  Full player profile modal 
// Shows a detailed card for a player in a modal overlay (same iframe container
// used for login/register). Styles are injected once on first use.

function openPlayerModal(player) {
    let overlay = document.getElementById('modalOverlay');
    if (!overlay) {
        overlay           = document.createElement('div');
        overlay.id        = 'modalOverlay';
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closePlayerModalSafe);
    }
    let box = document.getElementById('dynamicModalContainer');
    if (!box) {
        box           = document.createElement('div');
        box.id        = 'dynamicModalContainer';
        box.className = 'modal-frame';
        document.body.appendChild(box);
    }

    const statusText  = { active: 'Active now', recent: `Active ${player.lastActive}`, offline: 'Offline' }[player.status];
    const statusColor = { active: '#39d98a', recent: '#f5a623', offline: '#6c6f78' }[player.status];
    player.games = (player.games || []).map(displayGameName);
    const gameTags    = player.games.map(g => `<span class="modal-game-tag">${g}</span>`).join('');

    box.innerHTML = `
        <div class="player-modal">
            <button class="close-btn-modal" onclick="window.closePlayerModal()">✕</button>
            <div class="player-modal-scroll">
                <div class="player-modal-header">
                    <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.avatarSeed || player.gamertag)}"
                         class="player-avatar-img" alt="${player.gamertag}">
                    <div class="player-info">
                        <div class="player-name">${player.gamertag}</div>
                        <div class="player-status" style="color:${statusColor}">● ${statusText}</div>
                    </div>
                </div>
                <div class="player-section"><div class="section-label">Games</div><div class="player-games">${gameTags}</div></div>
                <div class="player-section"><div class="section-label">Rank</div><div>${player.rank}</div></div>
                <div class="player-section"><div class="section-label">Age</div><div>${player.age}</div></div>
                <div class="map-friend-actions">${mapFriendActions(player)}</div>
            </div>
        </div>`;

    // Inject styles once prevents duplicating the <style> tag on repeat opens
    if (!document.getElementById('player-modal-styles')) {
        const s   = document.createElement('style');
        s.id      = 'player-modal-styles';
        s.textContent = `
            .player-modal{width:100%;height:100%;background:rgba(14,15,18,0.95);backdrop-filter:blur(32px);border-radius:28px;padding:30px 25px 35px;color:#dbdee1;position:relative;box-sizing:border-box;border:1px solid rgba(155,89,182,0.3);}
            // ::before is the actual gradient border; ::after is an inner fill that covers it,
            // leaving only a thin rim visible. The neon-sweep keyframe slides the gradient's
            // background-position so it appears to travel around the card border.
            .player-modal::before{content:'';position:absolute;top:-2px;left:-2px;right:-2px;bottom:-2px;background:linear-gradient(90deg,transparent,#9b59b6,#c084fc,#e9d5ff,#c084fc,#9b59b6,transparent);border-radius:30px;z-index:-2;animation:neon-sweep 3s linear infinite;background-size:200% 100%;pointer-events:none;}
            .player-modal::after{content:'';position:absolute;top:2px;left:2px;right:2px;bottom:2px;background:rgba(14,15,18,0.95);backdrop-filter:blur(32px);border-radius:26px;z-index:-1;pointer-events:none;}
            @keyframes neon-sweep{0%{background-position:100% 0}100%{background-position:-100% 0}}
            .close-btn-modal{position:absolute;top:15px;right:15px;background:rgba(30,31,34,0.6);border:1px solid rgba(155,89,182,0.4);color:#c084fc;font-size:16px;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:all 0.2s;z-index:10;}
            .close-btn-modal:hover{background:rgba(155,89,182,0.2);border-color:rgba(155,89,182,0.8);}
            .player-modal-header{display:flex;align-items:center;gap:15px;margin-bottom:25px;}
            .player-modal-scroll{flex:1;overflow-y:auto;padding:30px 25px 35px;scrollbar-width:none;}
            .player-modal-scroll::-webkit-scrollbar{display:none;}
            .player-avatar-img{width:62px;height:62px;border-radius:50%;border:2.5px solid #9b59b6;box-shadow:0 0 12px rgba(155,89,182,0.4);object-fit:cover;flex-shrink:0;}
            .player-name{font-size:20px;font-weight:700;} .player-status{font-size:12px;margin-top:5px;}
            .player-section{margin-bottom:18px;} .section-label{font-size:11px;font-weight:600;color:#c084fc;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}
            .player-games{display:flex;flex-wrap:wrap;gap:8px;}
            .modal-game-tag{background:rgba(30,31,34,0.7);border:1px solid rgba(155,89,182,0.3);padding:4px 10px;border-radius:20px;font-size:12px;}
            .modal-chat-btn{width:100%;background:linear-gradient(135deg,#9b59b6,#7c3aed);border:none;color:white;padding:12px;border-radius:40px;font-size:14px;font-weight:bold;cursor:pointer;margin-top:15px;transition:all 0.2s;}
            .modal-chat-btn:hover{opacity:0.9;transform:translateY(-1px);}`;
        document.head.appendChild(s);
    }

    overlay.classList.add('show');
    box.classList.add('show');
    document.body.style.overflow = 'hidden';

    function onEsc(e) {
        if (e.key === 'Escape') { closePlayerModalSafe(); document.removeEventListener('keydown', onEsc); }
    }
    document.addEventListener('keydown', onEsc);
}

function closePlayerModalSafe() {
    const overlay = document.getElementById('modalOverlay');
    const box     = document.getElementById('dynamicModalContainer');
    if (overlay) overlay.classList.remove('show');
    if (box) {
        box.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(() => { if (box) box.innerHTML = ''; }, 300);
    }
}
window.closePlayerModal = closePlayerModalSafe;

// Allow event popup to open the full profile modal
window._openProfileFromPopup = function(playerId) {
    const player = PLAYERS.find(p => p.id === playerId);
    if (player) { closeAllPopups(); openPlayerModal(player); }
};
window._openFullProfile = function(playerId) {
    const player = PLAYERS.find(p => p.id === playerId);
    if (player) { closeAllPopups(); openPlayerModal(player); }
};

// Close everything when clicking the map background
map.on('click', () => {
    closePanel();
    closeAllPopups();
    closePlayerModalSafe();
    closeModalPage();
    closeFilterDropdown();
});


//  Mini profile popup 
// First click on a regular player shows a compact blue card with
// rank, games, and a "View Full Profile" button. Styles are injected once.

let activeMiniPopup = null;

function showMiniProfile(player) {
    closeAllPopups();

    const statusColor = { active: '#39d98a', recent: '#f5a623', offline: '#6c6f78' }[player.status] || '#6c6f78';
    const statusLabel = { active: 'Active now', recent: `Active ${player.lastActive}`, offline: 'Offline' }[player.status];
    player.games = (player.games || []).map(displayGameName);
    const gamesStr    = (player.games || []).join(' · ');
    const avatarSrc   = dicebearAvatar(player.avatarSeed || player.gamertag);

    activeMiniPopup = new maplibregl.Popup({
        closeButton: false, closeOnClick: true, offset: [0, -20], maxWidth: '300px'
    })
        .setLngLat([player.lng, player.lat])
        .setHTML(`
            <div class="mini-profile-inner">
                <div class="mini-profile-header">
                    <img src="${avatarSrc}" class="mini-profile-avatar" alt="${player.gamertag}">
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
                <div class="map-friend-actions">${mapFriendActions(player)}</div>
            </div>`)
        .addClassName('mini-profile-popup')
        .addTo(map);

    // Inject styles once
    if (!document.getElementById('mini-profile-styles')) {
        const s   = document.createElement('style');
        s.id      = 'mini-profile-styles';
        s.textContent = `
            .mini-profile-popup .maplibregl-popup-content{background:#0f1923!important;border:1.5px solid rgba(96,165,250,0.5)!important;border-radius:10px!important;padding:20px 22px 18px!important;box-shadow:0 16px 48px rgba(0,0,0,0.7)!important;min-width:260px;}
            .mini-profile-popup .maplibregl-popup-tip{border-top-color:rgba(96,165,250,0.5)!important;}
            .mini-profile-popup .maplibregl-popup-close-button{display:none!important;}
            .mini-profile-inner{display:flex;flex-direction:column;gap:12px;}
            .mini-profile-header{display:flex;align-items:center;gap:14px;}
            .mini-profile-avatar{width:50px;height:50px;border-radius:50%;border:1.5px solid rgba(96,165,250,0.4);object-fit:cover;flex-shrink:0;background:#0f1923;}
            .mini-profile-name{font-size:17px;font-weight:800;color:#f0f9ff;font-family:'Orbitron',sans-serif;letter-spacing:0.5px;}
            .mini-profile-status{font-size:12px;margin-top:3px;font-weight:700;}
            .mini-profile-divider{height:1px;background:rgba(96,165,250,0.15);}
            .mini-profile-row{display:flex;justify-content:space-between;align-items:center;}
            .mini-profile-label{font-size:10px;font-weight:700;color:#60a5fa;text-transform:uppercase;letter-spacing:1px;}
            .mini-profile-value{font-size:13px;color:#e0f2fe;font-weight:600;}
            .mini-profile-games{font-size:12px;color:#94a3b8;font-weight:500;}
            .mini-profile-btn{width:100%;background:#1d4ed8;border:none;color:#e0f2fe;padding:11px 14px;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer;transition:all 0.2s;text-transform:uppercase;letter-spacing:1px;font-family:inherit;}
            .mini-profile-btn:hover{background:#2563eb;box-shadow:0 4px 14px rgba(37,99,235,0.5);}
            /* Shared event popup styles */
            .event-name-link{color:#f0f9ff;text-decoration:none;font-size:16px;font-weight:800;font-family:'Orbitron',sans-serif;transition:color 0.15s;}
            .event-name-link:hover{color:#39d98a;}
            .event-popup-header{display:flex;align-items:center;gap:10px;}
            .event-popup-avatar{width:46px;height:46px;border-radius:50%;border:2px solid rgba(57,217,138,0.5);flex-shrink:0;}
            .event-popup-status{font-size:11px;font-weight:600;margin-top:2px;}
            .event-popup-badge{margin-left:auto;background:rgba(57,217,138,0.15);border:1px solid rgba(57,217,138,0.5);color:#39d98a;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1px;padding:2px 7px;border-radius:20px;white-space:nowrap;}
            .event-popup-divider{height:1px;background:rgba(57,217,138,0.15);margin:10px -2px;}
            .event-popup-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;}
            .event-popup-label{font-size:10px;font-weight:700;color:#39d98a;text-transform:uppercase;letter-spacing:1px;}
            .event-popup-value{font-size:12px;color:#e0f2fe;font-weight:600;text-align:right;max-width:160px;}
            .event-map-popup .maplibregl-popup-close-button{display:none!important;}`;
        document.head.appendChild(s);
    }
}


//  Event popup 
// Shown when clicking a player who has an active event.
// Green-themed popup with event details and a "Chat Now" button.

let activeEventPopup = null;

function closeAllPopups() {
    if (activeEventPopup) { activeEventPopup.remove(); activeEventPopup = null; }
    if (activeMiniPopup)  { activeMiniPopup.remove();  activeMiniPopup  = null; }
}

function fmtTime(h, m, ap) {
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

function showEventPopup(player, evt) {
    closeAllPopups();

    const timeStr     = fmtTime(evt.startHour, evt.startMin, evt.startAmPm);
    const endStr      = evt.hasEnd ? ` – ${fmtTime(evt.endHour, evt.endMin, evt.endAmPm)}` : ' · 2hr';
    const avatarSrc   = dicebearAvatar(player.avatarSeed || player.gamertag);
    const statusColor = { active: '#39d98a', recent: '#f5a623', offline: '#6c6f78' }[player.status] || '#6c6f78';

    activeEventPopup = new maplibregl.Popup({
        closeButton: false, closeOnClick: true, offset: [0, -20], maxWidth: '300px'
    })
        .setLngLat([player.lng, player.lat])
        .setHTML(`
            <div class="event-popup-inner">
                <div class="event-popup-header">
                    <img src="${avatarSrc}" class="event-popup-avatar" alt="${player.gamertag}">
                    <div>
                        <a href="#" class="event-name-link" onclick="window._openProfileFromPopup(${player.id});return false;">${player.gamertag}</a>
                        <div class="event-popup-status" style="color:${statusColor}">&#9679; Live Event</div>
                    </div>
                    <span class="event-popup-badge">LIVE</span>
                </div>
                <div class="event-popup-divider"></div>
                <div class="event-popup-row"><span class="event-popup-label">Game</span><span class="event-popup-value">${evt.gameName}</span></div>
                <div class="event-popup-row"><span class="event-popup-label">Event</span><span class="event-popup-value">${evt.eventName}</span></div>
                <div class="event-popup-row"><span class="event-popup-label">Time</span><span class="event-popup-value">${timeStr}${endStr}</span></div>
                <button class="event-popup-chat" onclick="window.location.href='/chat'">Chat Now</button>
            </div>`)
        .addClassName('event-map-popup')
        .addTo(map);
}


//  Sidebar helpers 

function closePanel() {
    document.getElementById('sidebar')?.classList.remove('open');
    const empty = document.getElementById('sidebarEmpty');
    const card  = document.getElementById('profileCard');
    if (empty) empty.style.display = 'flex';
    if (card)  card.style.display  = 'none';
}


//  Hamburger menu 

function toggleMenu() {
    document.getElementById('sideMenu')?.classList.toggle('open');
    document.getElementById('menuOverlay')?.classList.toggle('show');
}

function closeMenu() {
    document.getElementById('sideMenu')?.classList.remove('open');
    document.getElementById('menuOverlay')?.classList.remove('show');
}

function updateLoginLogoutButton() {
    const el = document.getElementById('loginLogoutText');
    if (el) el.textContent = isLoggedIn ? 'Logout' : 'Login';
}

async function handleLogout() {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); }
    catch (e) { console.warn('Logout failed:', e); }
    setLoggedIn(false, null);
    if (mapSocket) { mapSocket.close(); mapSocket = null; }
    // Refresh admin panel after logout
    if (window.checkAdmin) window.checkAdmin();
    alert('Logged out successfully');
}

// Menu links
function handleMenuClick(page) {
    closeMenu();
    switch (page) {
        case 'home':          map.invalidateSize(); break;
        case 'chat':          window.location.href = '/chat'; break;
        case 'notifications': alert('Notifications coming soon'); break;
        case 'settings':      openModalPage('/settings'); break;
        case 'login':         isLoggedIn ? handleLogout() : openModalPage('/login'); break;
    }
}


//  Filter dropdown 

function toggleFilterDropdown() { document.getElementById('filterDropdown')?.classList.toggle('show'); }
function closeFilterDropdown()  { document.getElementById('filterDropdown')?.classList.remove('show'); }

// Reads values from custom-select data-value attributes (not native <select>)
function applyFilters() {
    const ageFilter      = document.getElementById('filterAge')?.dataset.value      || 'all';
    const gameFilter     = document.getElementById('filterGames')?.dataset.value    || 'all';
    const locationFilter = document.getElementById('filterLocation')?.dataset.value || 'all';

    let filtered = getVisiblePlayers();

    if (gameFilter !== 'all')
        filtered = filtered.filter(p => p.games.some(g => g.toLowerCase() === gameFilter.toLowerCase()));

    if (ageFilter === '18-25')       filtered = filtered.filter(p => p.age >= 18 && p.age <= 25);
    else if (ageFilter === '26-35')  filtered = filtered.filter(p => p.age >= 26 && p.age <= 35);
    else if (ageFilter === '36-45')  filtered = filtered.filter(p => p.age >= 36 && p.age <= 45);
    else if (ageFilter === '45+')    filtered = filtered.filter(p => p.age >= 45);

    if (locationFilter !== 'all')
        filtered = filtered.filter(p => p.location === locationFilter);

    renderPlayers(filtered);
    closeFilterDropdown();
}

// Badge counts for each city in the location dropdown
function updateLocationCounts() {
    const counts = { all: PLAYERS.length, malmo: 0, goteborg: 0, stockholm: 0 };
    PLAYERS.forEach(p => { if (counts[p.location] !== undefined) counts[p.location]++; });
    Object.entries(counts).forEach(([loc, n]) => {
        const el = document.getElementById(`cnt-${loc}`);
        if (el) el.textContent = n;
    });
}

// Custom glassy select component handles open/close and value selection
function initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(sel => {
        const trigger = sel.querySelector('.custom-select-trigger');
        const options = sel.querySelectorAll('.custom-select-option');
        const label   = sel.querySelector('.custom-select-label');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = sel.classList.contains('open');
            document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
            if (!isOpen) sel.classList.add('open');
        });

        options.forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                options.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                sel.dataset.value = opt.dataset.value;
                // Use the first span text so count badges don't bleed into the label
                label.textContent = opt.querySelector('span:first-child')?.textContent || opt.textContent.trim();
                sel.classList.remove('open');
            });
        });
    });

    // Clicking anywhere outside closes all open custom selects
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
    });
}


//  Admin panel 
// Checks the session role and shows/hides the admin panel accordingly.
// Also loads the event list so admins can delete events from the map page.

async function checkAdmin() {
    const res  = await fetch('/api/me');
    const data = await res.json();
    const panel = document.getElementById('adminPanel');
    if (data.logged_in && data.role) {
        if (panel) panel.style.display = 'block';
        loadAdminEvents();
    } else {
        if (panel) panel.style.display = 'none';
    }
}
// Expose so login.js can call it after login
window.checkAdmin = checkAdmin;

async function loadAdminEvents() {
    const res  = await fetch('/api/events');
    const data = await res.json();
    const container = document.getElementById('eventList');
    if (!container) return;
    container.innerHTML = '';
    (data.events || []).forEach(event => {
        const div       = document.createElement('div');
        div.innerHTML   = `<span>${event.title}</span><button onclick="adminDeleteEvent(${event.id})">Delete</button>`;
        container.appendChild(div);
    });
}

async function adminDeleteEvent(id) {
    const res  = await fetch(`/api/admin/delete_event/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) loadAdminEvents();
    else alert('Error deleting event');
}
window.adminDeleteEvent = adminDeleteEvent;

async function addGame() {
    const name  = document.getElementById('gameNameInput')?.value;
    const image = document.getElementById('gameImageInput')?.value;
    if (!name) return;
    const res  = await fetch('/api/admin/add_game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image_name: image })
    });
    const data = await res.json();
    document.getElementById('gameMsg').textContent = data.success ? 'Game added!' : 'Error: ' + data.error;
}
window.addGame = addGame;


//  DOMContentLoaded 

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('hamburgerBtn')?.addEventListener('click', toggleMenu);
    document.getElementById('menuCloseBtn')?.addEventListener('click', closeMenu);
    document.getElementById('menuOverlay')?.addEventListener('click', closeMenu);

    document.querySelectorAll('.menu-items li').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const page = item.getAttribute('data-page');
            if (page) handleMenuClick(page);
        });
    });

    document.getElementById('filterToggleBtn')?.addEventListener('click', toggleFilterDropdown);
    document.getElementById('applyFilters')?.addEventListener('click', applyFilters);

    // Close filter dropdown when clicking outside the filter area
    document.addEventListener('click', (e) => {
        const ff = document.querySelector('.filter-float');
        const dd = document.getElementById('filterDropdown');
        if (ff && dd && !ff.contains(e.target) && dd.classList.contains('show')) closeFilterDropdown();
    });

    // Profile pic: open profile modal if logged in, login modal if not
    document.getElementById('profilePic')?.addEventListener('click', () => {
        if (isLoggedIn) openModalPage('/profile');
        else openModalPage('/login');  // go straight to login, no alert
    });

    updateLoginLogoutButton();
    checkSession();
    setInterval(sendMapPresence, 15000);
    checkAdmin();         // show admin panel for admins
    initEventSystem();    // event creation button + form
    initCustomSelects();  // custom glassy dropdowns
    updateLocationCounts(); // city player counts

    // Auto-open login modal if redirected here with ?login=1 (e.g. from chat page)
    if (new URLSearchParams(window.location.search).get('login') === '1') {
        // Small delay so the map finishes loading before the modal appears
        setTimeout(() => openModalPage('/login'), 400);
        // Clean the URL so a page refresh doesn't re-open the login modal.
        // replaceState updates the address bar without adding a history entry.
        history.replaceState({}, '', '/map');
    }
});


//  Event system
//  Lets logged-in users post a gaming event that appears as a pulsing
//  green ring on the map behind their marker. Other players can click
//  the marker to see a green event popup with time and game details.

// Pre-loaded demo events so the map isn't empty on first visit
let activeEvents = [
    { playerId: 1, eventName: 'Friday Ranked Grind', gameName: 'Valorant', startHour: 8,  startMin: 0,  startAmPm: 'PM', hasEnd: false },
    { playerId: 6, eventName: 'CS2 5v5 Scrim',       gameName: 'CS2',      startHour: 9,  startMin: 30, startAmPm: 'PM', hasEnd: true, endHour: 11, endMin: 0, endAmPm: 'PM' }
];

const pulseMarkers = {}; // playerId → removal handle


//  Scroll-drum time picker 
// Builds a draggable scroll drum showing exactly 3 rows (prev / selected / next).
// Used inside the event creation form for hour and minute selection.

function buildDrum(items, initialIndex = 0) {
    const ITEM_H = 42;
    const CENTER = 1; // center row index (0=top, 1=middle, 2=bottom in a 3-row view)

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position:relative;height:${ITEM_H * 3}px;overflow:hidden;cursor:grab;user-select:none;width:100%;`;
    // CSS mask fades the top and bottom rows out so the drum looks like it extends
    // infinitely behind the selection highlight the transparency gives the illusion of depth.
    wrapper.style.webkitMaskImage = 'linear-gradient(to bottom,transparent 0%,black 28%,black 72%,transparent 100%)';
    wrapper.style.maskImage       = 'linear-gradient(to bottom,transparent 0%,black 28%,black 72%,transparent 100%)';

    const track = document.createElement('div');
    track.style.cssText = 'position:absolute;width:100%;will-change:transform;';

    // Triple the items list so we can scroll "past the end" and silently jump back
    // to the middle copy creating the illusion of infinite looping without the user
    // ever seeing a hard reset.
    const tripled = [...items, ...items, ...items];
    tripled.forEach(label => {
        const el = document.createElement('div');
        el.className = 'drum-item';
        el.textContent = label;
        el.style.cssText = `height:${ITEM_H}px;line-height:${ITEM_H}px;text-align:center;font-size:18px;font-weight:700;color:#555;transition:color 0.12s,font-size 0.12s;`;
        track.appendChild(el);
    });
    wrapper.appendChild(track);

    const bar = document.createElement('div');
    bar.style.cssText = `position:absolute;top:${ITEM_H * CENTER}px;left:2px;right:2px;height:${ITEM_H}px;border:1.5px solid rgba(57,217,138,0.55);border-radius:8px;background:rgba(57,217,138,0.08);pointer-events:none;`;
    wrapper.appendChild(bar);

    let cur = items.length + initialIndex;

    function paint(idx) {
        track.querySelectorAll('.drum-item').forEach((el, i) => {
            const d = Math.abs(i - idx);
            if (d === 0)      { el.style.color = '#39d98a'; el.style.fontSize = '20px'; }
            else if (d === 1) { el.style.color = '#999';    el.style.fontSize = '14px'; }
            else              { el.style.color = 'transparent'; el.style.fontSize = '12px'; }
        });
    }
    function snap(idx, animate) {
        track.style.transition = animate ? 'transform 0.18s cubic-bezier(0.25,0.46,0.45,0.94)' : 'none';
        track.style.transform  = `translateY(${-(idx - CENTER) * ITEM_H}px)`;
        paint(idx);
    }
    // normalize() silently jumps `cur` back into the middle copy of the tripled array
    // when the user has dragged far enough to reach the first or last copy. Because
    // the snap happens with animate=false there's no visible jump.
    function normalize() {
        if (cur < items.length)           { cur += items.length; snap(cur, false); }
        else if (cur >= items.length * 2) { cur -= items.length; snap(cur, false); }
    }
    snap(cur, false);

    let startY = 0, startCur = 0, dragging = false;
    wrapper.addEventListener('mousedown',  e => { dragging = true; startY = e.clientY; startCur = cur; wrapper.style.cursor = 'grabbing'; });
    wrapper.addEventListener('touchstart', e => { dragging = true; startY = e.touches[0].clientY; startCur = cur; }, { passive: true });
    window.addEventListener('mousemove',  e => { if (!dragging) return; cur = startCur + Math.round((startY - e.clientY) / ITEM_H); snap(cur, false); });
    window.addEventListener('touchmove',  e => { if (!dragging) return; cur = startCur + Math.round((startY - e.touches[0].clientY) / ITEM_H); snap(cur, false); }, { passive: true });
    const endDrag = () => { if (!dragging) return; dragging = false; wrapper.style.cursor = 'grab'; snap(cur, true); setTimeout(normalize, 200); };
    window.addEventListener('mouseup',  endDrag);
    window.addEventListener('touchend', endDrag);
    wrapper.addEventListener('wheel', e => { e.preventDefault(); cur += e.deltaY > 0 ? 1 : -1; snap(cur, true); setTimeout(normalize, 220); }, { passive: false });

    return {
        el: wrapper,
        // getValue() maps the absolute `cur` index back to a value in the original items array.
        // The double-modulo ((x % n) + n) % n handles negative values correctly plain % in JS
        // can return negative numbers for negative operands, which would give wrong results here.
        getValue: () => items[((cur - items.length) % items.length + items.length) % items.length]
    };
}

// AM/PM toggle two clickable labels beside the drum
function buildAmPmToggle(initial = 'PM') {
    let value = initial;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;';
    ['AM', 'PM'].forEach(label => {
        const btn = document.createElement('div');
        btn.textContent = label;
        btn.dataset.val = label;
        const sel = label === initial;
        btn.style.cssText = `width:48px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;transition:all 0.15s;${sel?'background:rgba(57,217,138,0.18);border:1.5px solid rgba(57,217,138,0.6);color:#39d98a;':'background:transparent;border:1.5px solid transparent;color:#555;'}`;
        btn.addEventListener('click', () => {
            value = label;
            wrap.querySelectorAll('div').forEach(b => {
                const s = b.dataset.val === value;
                b.style.background = s ? 'rgba(57,217,138,0.18)' : 'transparent';
                b.style.border     = s ? '1.5px solid rgba(57,217,138,0.6)' : '1.5px solid transparent';
                b.style.color      = s ? '#39d98a' : '#555';
            });
        });
        wrap.appendChild(btn);
    });
    return { el: wrap, getValue: () => value };
}

// Combines hour drum + colon + minute drum + divider + AM/PM toggle
function buildTimePicker(initH = 8, initM = 0, initAmPm = 'PM') {
    const hours   = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    const minutes = ['00','05','10','15','20','25','30','35','40','45','50','55'];
    const hIdx    = hours.indexOf(String(initH));
    const mStr    = String(initM).padStart(2, '0');
    const mIdx    = minutes.includes(mStr) ? minutes.indexOf(mStr) : 0;

    const hourDrum   = buildDrum(hours,   hIdx >= 0 ? hIdx : 7);
    const minDrum    = buildDrum(minutes, mIdx);
    const ampm       = buildAmPmToggle(initAmPm);

    const container = document.createElement('div');
    container.style.cssText = 'display:flex;align-items:center;gap:0;background:rgba(10,11,14,0.75);border:1px solid rgba(57,217,138,0.25);border-radius:14px;padding:8px 10px;';
    hourDrum.el.style.width = '44px';
    minDrum.el.style.width  = '44px';

    const colon   = document.createElement('div');
    colon.textContent = ':';
    colon.style.cssText = 'color:#39d98a;font-size:22px;font-weight:800;padding:0 4px;line-height:1;';

    const divider = document.createElement('div');
    divider.style.cssText = 'width:1px;height:80px;background:rgba(57,217,138,0.2);margin:0 10px;';

    container.appendChild(hourDrum.el);
    container.appendChild(colon);
    container.appendChild(minDrum.el);
    container.appendChild(divider);
    container.appendChild(ampm.el);

    return { el: container, getHour: () => parseInt(hourDrum.getValue()), getMin: () => parseInt(minDrum.getValue()), getAmPm: () => ampm.getValue() };
}


//  initEventSystem 
// Injects the green "+" button and the event creation form overlay into the map area.
// Also wires up submit logic and draws initial pulse rings for demo events.

function initEventSystem() {
    const mapArea = document.querySelector('.map-area');
    if (!mapArea) return;

    // + button
    const addBtn   = document.createElement('button');
    addBtn.className = 'event-add-btn';
    addBtn.innerHTML = '+';
    addBtn.title     = 'Create Event';
    mapArea.appendChild(addBtn);

    // Form overlay
    const overlay = document.createElement('div');
    overlay.className = 'event-form-overlay';
    overlay.id        = 'eventFormOverlay';
    overlay.innerHTML = `
        <div class="event-form-card">
            <button class="event-form-close" id="eventFormClose">✕</button>
            <div class="event-form-title">Create Event</div>
            <div class="event-form-subtitle">Let nearby players find and join you</div>
            <div class="event-form-error" id="eventFormError"></div>
            <div class="event-field"><label>Event Name</label><input class="event-input" id="evtName" type="text" placeholder="e.g. Friday Ranked Grind"></div>
            <div class="event-field"><label>Game</label><input class="event-input" id="evtGame" type="text" placeholder="e.g. Valorant, CS2, Minecraft"></div>
            <div class="event-field"><label>Start Time</label><div id="evtStartPicker"></div></div>
            <div class="event-field">
                <label>End Time <span class="event-label-note">(optional)</span></label>
                <div id="evtEndPicker"></div>
                <p class="event-field-note">Leave unchanged and the event auto-closes after 2 hours.</p>
            </div>
            <button class="event-submit-btn" id="eventSubmitBtn">Start Event</button>
        </div>`;
    mapArea.appendChild(overlay);

    // Helpers
    function to24mins(h, m, ap) {
        let hour = h % 12;
        if (ap === 'PM') hour += 12;
        return hour * 60 + m;
    }
    function nowRounded() {
        const now = new Date();
        let h = now.getHours(), m = Math.ceil(now.getMinutes() / 5) * 5;
        if (m === 60) { m = 0; h = (h + 1) % 24; }
        return { h12: h % 12 || 12, m, ap: h >= 12 ? 'PM' : 'AM', totalMins: h * 60 + m };
    }
    function addMins(total, add) {
        const t   = (total + add) % 1440;
        const h24 = Math.floor(t / 60);
        return { h12: h24 % 12 || 12, m: t % 60, ap: h24 >= 12 ? 'PM' : 'AM' };
    }

    const seed    = nowRounded();
    const endSeed = addMins(seed.totalMins, 120);
    const endMr   = Math.round(endSeed.m / 5) * 5 % 60;

    const startPicker = buildTimePicker(seed.h12, seed.m, seed.ap);
    const endPicker   = buildTimePicker(endSeed.h12, endMr, endSeed.ap);
    document.getElementById('evtStartPicker').appendChild(startPicker.el);
    document.getElementById('evtEndPicker').appendChild(endPicker.el);

    // Open / close
    addBtn.addEventListener('click', () => {
        if (!isLoggedIn) { alert('Please login first to create an event'); openModalPage('/login'); return; }
        overlay.classList.add('show');
    });
    document.getElementById('eventFormClose').addEventListener('click', () => overlay.classList.remove('show'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });

    // Submit
    document.getElementById('eventSubmitBtn').addEventListener('click', () => {
        const name  = document.getElementById('evtName').value.trim();
        const game  = document.getElementById('evtGame').value.trim();
        const errEl = document.getElementById('eventFormError');

        if (!name || !game) {
            errEl.textContent = 'Please fill in both Event Name and Game.';
            errEl.style.display = 'block';
            return;
        }

        const startH  = startPicker.getHour(), startM  = startPicker.getMin(), startAp = startPicker.getAmPm();
        const endH    = endPicker.getHour(),   endM    = endPicker.getMin(),   endAp   = endPicker.getAmPm();

        const nowMins   = new Date().getHours() * 60 + new Date().getMinutes();
        const startMins = to24mins(startH, startM, startAp);

        if (startMins < nowMins) {
            errEl.textContent = `Start time ${startH}:${String(startM).padStart(2,'0')} ${startAp} is in the past.`;
            errEl.style.display = 'block';
            return;
        }

        const endMins  = to24mins(endH, endM, endAp);
        // The user hasn't touched the end picker if its current values still match
        // the initial seed we pre-filled it with treat that as "no end time set".
        const hasEnd   = !(endH === endSeed.h12 && endM === endMr && endAp === endSeed.ap);
        if (hasEnd && endMins <= startMins) {
            errEl.textContent = 'End time must be after the start time.';
            errEl.style.display = 'block';
            return;
        }

        errEl.style.display = 'none';

        const demo       = PLAYERS.find(p => p.isDemo);
        const demoId     = demo ? demo.id : 99;
        activeEvents     = activeEvents.filter(e => e.playerId !== demoId);
        activeEvents.push({ playerId: demoId, eventName: name, gameName: game,
            startHour: startH, startMin: startM, startAmPm: startAp,
            hasEnd, endHour: endH, endMin: endM, endAmPm: endAp });

        overlay.classList.remove('show');
        document.getElementById('evtName').value = '';
        document.getElementById('evtGame').value = '';
        refreshEventMarkers();
    });

    // Draw initial pulse rings once the map markers are ready
    map.on('load', () => setTimeout(refreshEventMarkers, 500));
    if (map.loaded()) setTimeout(refreshEventMarkers, 300);
}


function spreadOverlappingPlayers(players) {
    const seen = new Map();
    return players.map(p => {
        const key = `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;
        const i = seen.get(key) || 0;
        seen.set(key, i + 1);
        if (!i) return p;

        const r = 0.00012 * Math.ceil(i / 6);
        const a = (i % 6) * (Math.PI * 2 / 6);
        return { ...p, lat: p.lat + Math.sin(a) * r, lng: p.lng + Math.cos(a) * r };
    });
}

// Redraws pulse rings on all players who currently have an active event.
// Rings are injected into the avatar marker element so they stay centred on pan/zoom.
function refreshEventMarkers() {
    // Clear all existing pulse rings
    Object.values(playerMarkers).forEach(({ el }) => el.querySelectorAll('.pulse-ring').forEach(r => r.remove()));
    Object.values(pulseMarkers).forEach(m => { try { m.remove(); } catch (e) {} });
    Object.keys(pulseMarkers).forEach(k => delete pulseMarkers[k]);

    activeEvents.forEach(evt => {
        const player     = window.currentPlayersForMap().find(p => p.id === evt.playerId);
        if (!player) return;
        const markerData = playerMarkers[player.id];
        if (!markerData) return;

        // Three rings with staggered delays → heartbeat / radio-wave effect
        ['', 'delay1', 'delay2'].forEach(cls => {
            const ring       = document.createElement('div');
            ring.className   = 'pulse-ring' + (cls ? ' ' + cls : '');
            markerData.el.insertBefore(ring, markerData.el.firstChild);
        });

        pulseMarkers[player.id] = {
            remove: () => {
                if (playerMarkers[player.id])
                    playerMarkers[player.id].el.querySelectorAll('.pulse-ring').forEach(r => r.remove());
            }
        };
    });
}