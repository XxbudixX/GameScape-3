// map.js GameScape map page
const MAPTILER_KEY   = window.MAPTILER_KEY || '';
const MAPTILER_STYLE = `https://api.maptiler.com/maps/019d1f6a-0bb2-7db3-a9c7-670e85ac0f84/style.json?key=${MAPTILER_KEY}`;

const PLAYERS = [];

window.livePlayers = [];
window.currentPlayersForMap = function () {
    return window.livePlayers;

};


function getVisiblePlayers() {
    return window.currentPlayersForMap();
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

function dicebearAvatar(seed) {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed || 'GameScape')}`;
}

// Icons live as files in /static/icons (e.g. discord.svg, steam.svg). Rendered
// as a CSS mask so the colour comes from CSS (currentColor), not the file.
const ICON_PATH = '/static/icons';
function iconImg(name, cls) {
    return `<span class="icon icon-${name}${cls ? ' ' + cls : ''}"></span>`;
}

function displayGameName(game) {
    return typeof game === 'string' ? game : (game && game.name ? game.name : 'Game');
}

// ---------------------------------------------------------------------------
//  Unified, DB-synced friend buttons (shared logic with the chat page)
//  The authoritative state lives in the database and is read from /api/friends.
//  Every "Add Friend" button anywhere on the page is rendered from the same
//  cache, so adding / cancelling in one place updates them all instantly.
// ---------------------------------------------------------------------------

let myFriendState = { friends: [], incoming: [], outgoing: [] };

async function loadMyFriendState() {
    if (!isLoggedIn) { myFriendState = { friends: [], incoming: [], outgoing: [] }; return; }
    try {
        const res  = await fetch('/api/friends', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (data && data.success) {
            myFriendState = {
                friends:  data.friends  || [],
                incoming: data.incoming || [],
                outgoing: data.outgoing || []
            };
            gsSyncFriendButtons();
        }
    } catch (e) { console.warn('Failed to load friend state:', e); }
}

// Resolve the current relationship to a user straight from the DB-backed cache.
function gsFriendState(username) {
    if (!username) return 'none';
    if ((myFriendState.friends  || []).some(f => f.username === username)) return 'friends';
    if ((myFriendState.incoming || []).some(r => r.username === username)) return 'incoming';
    if ((myFriendState.outgoing || []).some(r => r.username === username)) return 'outgoing';
    return 'none';
}

// HTML for the controls inside a wrap, chosen by state.
// hideRemove: in the full profile modal we only want a Chat button for friends
// (the Remove action lives on the chat page instead).
function gsFriendControlsInner(state, hideRemove) {
    if (state === 'friends')  return `<button class="gs-friend-btn" data-gs-act="chat">Chat</button>`
                                   + (hideRemove ? '' : `<button class="gs-friend-btn gs-muted" data-gs-act="remove">Remove</button>`);
    if (state === 'incoming') return `<button class="gs-friend-btn" data-gs-act="accept">Accept</button>`
                                   + `<button class="gs-friend-btn gs-muted" data-gs-act="ignore">Ignore</button>`;
    if (state === 'outgoing') return `<button class="gs-friend-btn gs-sent" data-gs-act="cancel">`
                                   + `<span class="gs-fb-main">Sent!</span><span class="gs-fb-alt">Cancel</span></button>`;
    return `<button class="gs-friend-btn" data-gs-act="add">Add Friend</button>`;
}

// Full wrap markup for a given user. `fill` makes the buttons stretch (cards).
function gsFriendControls(username, fill, opts) {
    const hideRemove = !!(opts && opts.hideRemove);
    const state = gsFriendState(username);
    return `<div class="gs-friend-wrap${fill ? ' gs-fill' : ''}" data-gs-user="${username}" data-gs-state="${state}"${hideRemove ? ' data-gs-noremove="1"' : ''}>`
         + gsFriendControlsInner(state, hideRemove) + `</div>`;
}

// Re-render every friend wrap currently in the DOM from the cache so all
// instances (mini profile, full profile, anything open) stay in sync.
function gsSyncFriendButtons() {
    document.querySelectorAll('.gs-friend-wrap[data-gs-user]').forEach(wrap => {
        const username = wrap.dataset.gsUser;
        const state    = gsFriendState(username);
        if (wrap.dataset.gsState !== state) {
            wrap.dataset.gsState = state;
            wrap.innerHTML = gsFriendControlsInner(state, wrap.dataset.gsNoremove === '1');
        }
    });
}

// Optimistically move a user to a new state in the local cache (before the
// server confirms) so the UI feels instant, then sync all buttons.
function gsSetLocalState(username, state) {
    ['friends', 'incoming', 'outgoing'].forEach(k => {
        myFriendState[k] = (myFriendState[k] || []).filter(x => x.username !== username);
    });
    if (state === 'friends')  myFriendState.friends.push({ username });
    if (state === 'incoming') myFriendState.incoming.push({ username });
    if (state === 'outgoing') myFriendState.outgoing.push({ username });
    gsSyncFriendButtons();
}

async function gsFriendRequest(action, username) {
    let url = '/api/friends/request';
    let method = 'POST';
    if (action === 'accept') url = '/api/friends/accept';
    if (action === 'ignore') url = '/api/friends/ignore';
    if (action === 'cancel' || action === 'remove') { url = `/api/friends/${encodeURIComponent(username)}`; method = 'DELETE'; }
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (method !== 'DELETE') options.body = JSON.stringify({ username });
    const res  = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || 'Friend action failed');
    return data;
}

// Single delegated handler for every friend button on the page.
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-gs-act]');
    if (!btn) return;
    const wrap = btn.closest('.gs-friend-wrap');
    if (!wrap) return;
    e.preventDefault();
    e.stopPropagation();

    const username = wrap.dataset.gsUser;
    const act      = btn.dataset.gsAct;

    if (act === 'chat') { window.location.href = `/chat?user=${encodeURIComponent(username)}`; return; }

    // Optimistic state so the button flips immediately.
    const optimistic = act === 'add' ? 'outgoing'
                     : act === 'accept' ? 'friends'
                     : 'none'; // cancel / ignore / remove
    gsSetLocalState(username, optimistic);

    try {
        await gsFriendRequest(act, username);
    } catch (err) {
        alert(err.message);
    }
    // Reconcile with the real DB state (also re-syncs every button).
    await loadMyFriendState();
});

// Back-compat shim: the profile/mini-profile templates call mapFriendActions().
function mapFriendActions(player, opts) {
    if (!isLoggedIn || player.is_self || player.gamertag === currentUsername) return '';
    return gsFriendControls(player.gamertag, true, opts);
}

// Small HTML escaper for values fetched from the API.
function escMap(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

    if (status && username) sendMapPresence();

    // Pull the user's friend relationships so every Add Friend button reflects
    // the real database state; clear it on logout.
    if (status) loadMyFriendState();
    else { myFriendState = { friends: [], incoming: [], outgoing: [] }; gsSyncFriendButtons(); }
}

// Keep friend buttons in sync across devices/tabs (cheap GET every 5s).
setInterval(() => { if (isLoggedIn) loadMyFriendState(); }, 5000);

// Checks the server session on page load so a refreshed page stays logged in.
async function checkSession() {
    try {
        const res  = await fetch('/api/me', { credentials: 'same-origin' });
        const data = await res.json();

        if (data.logged_in) {
            window.myUserId = data.user_id;
            setLoggedIn(true, data.username, data.avatar_seed);
        }
    } catch (e) { console.warn('Session check failed:', e); }
}
function _postPresence(body) {
    fetch('/api/map/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body || {})
    }).catch(() => {});
}

function sendMapPresence() {
    if (!isLoggedIn) return;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => _postPresence({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            ()  => _postPresence({}),          // permission denied / error -> IP fallback
            { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
        );
    } else {
        _postPresence({});
    }
}
async function loadLivePlayers() {
    return; // WS-only: polling avstängt

    try {
        const res = await fetch('/api/players', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success) return;

        const incoming = (data.players || []);

        if (incoming.length > 0) {
            window.livePlayers = spreadOverlappingPlayers(
                incoming.map(p => ({ ...p, mapVisible: true }))
            );
        } else {
            window.livePlayers = null; // fallback till demo
        }

        renderMapMarkers(window.currentPlayersForMap());
        refreshEventMarkers?.();
    } catch (e) {
        console.warn('Failed to load live players:', e);
    }
}


//  Modal helpers 
// Opens any page (login / register / profile) in a centered iframe overlay.

function openModalPage(page, wide = false) {
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
    // Toggle the wide class based on the caller's request
    frame.classList.toggle('wide', wide);
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

function ensureMarkerStyles() { /* avatar marker styles moved to main.css */ }

// Builds one avatar marker DOM element for a player.
function buildAvatarMarkerEl(player) {
    const wrap = document.createElement('div');
    const isSelf = player.isDemo || (window.myUserId != null && player.id === window.myUserId);
    wrap.className = 'avatar-marker' + (isSelf ? ' demo-marker' : '');

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
        const isOwner = window.myUserId != null && player.id === window.myUserId;
        // Owner can open their event anytime (to delete it, even if scheduled);
        // others only see it once it's live.
        if (evt && (isOwner || isEventLive(evt))) showEventPopup(player, evt);
        else                                      showMiniProfile(player);
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

    box.innerHTML = `
        <div class="player-modal">
            <button class="close-btn-modal" onclick="window.closePlayerModal()">X</button>
            <div class="player-modal-scroll">
                <div class="player-modal-header">
                    <img src="${dicebearAvatar(player.avatarSeed || player.gamertag)}"
                         class="player-avatar-img" id="pmAvatar" alt="${escMap(player.gamertag)}">
                    <div class="player-info">
                        <div class="player-name">${escMap(player.gamertag)}</div>
                        <div class="player-status" style="color:${statusColor}">● ${statusText}</div>
                    </div>
                </div>
                <div class="player-section"><div class="section-label">Games</div><div class="player-games" id="pmGames"><span class="pm-loading">Loading...</span></div></div>
                <div class="player-section"><div class="section-label">About Me</div><div class="pm-about empty-hint" id="pmAbout">Loading...</div></div>
                <div class="player-section"><div class="section-label">Interests</div><div class="pm-about empty-hint" id="pmInterests">Loading...</div></div>
                <div class="player-section"><div class="section-label">Age</div><div>${escMap(player.age)}</div></div>
                <div class="player-section"><div class="section-label">Connect</div><div class="contact-boxes" id="pmContacts"></div></div>
                <div class="map-friend-actions">${mapFriendActions(player, { hideRemove: true })}</div>
            </div>
        </div>`;

    // Pull the full, up-to-date profile (games, about, interests, discord, steam)
    // straight from the database so it matches what the user set on their own
    // profile page.
    fillPlayerProfile(player.gamertag);


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
    const player = window.currentPlayersForMap().find(p => p.id === playerId);
    if (player) { closeAllPopups(); openPlayerModal(player); }
};
window._openFullProfile = function(playerId) {
    const player = window.currentPlayersForMap().find(p => p.id === playerId);
    if (player) { closeAllPopups(); openPlayerModal(player); }
};

// Discord / Steam contact boxes use the icon files in /static/icons.
function pmContactBox(kind, label, value) {
    const has = value && value.trim();
    return `<div class="contact-box${has ? '' : ' pm-contact-empty'}" ${has ? `data-pm-kind="${kind}" data-pm-label="${escMap(label)}" data-pm-value="${escMap(value)}"` : ''} title="${has ? 'Click to view & copy' : ''}">
        <div class="contact-box-icon">${iconImg(kind)}</div>
        <div class="contact-box-content">
            <span class="contact-box-label">${label}</span>
            <span class="contact-box-value${has ? '' : ' not-set'}">${has ? escMap(value) : 'Not set'}</span>
        </div>
        ${has ? '<div class="contact-box-copy-hint">click to copy</div>' : ''}
    </div>`;
}

// Fetch the viewed user's full profile + games and fill the modal sections so
// they mirror exactly what's shown on the editable profile page.
async function fillPlayerProfile(username) {
    const setText = (id, val, emptyMsg) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (val && String(val).trim()) { el.textContent = val; el.className = 'pm-about'; }
        else { el.textContent = emptyMsg; el.className = 'pm-about empty-hint'; }
    };

    // Profile fields
    try {
        const res  = await fetch(`/api/profile?user=${encodeURIComponent(username)}`, { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (data && data.success) {
            setText('pmAbout', data.about_me, 'No description yet');
            setText('pmInterests', data.interests, 'No interests added yet');
            const c = document.getElementById('pmContacts');
            if (c) c.innerHTML = pmContactBox('discord', 'Discord', data.discord)
                              + pmContactBox('steam',   'Steam',   data.steam_username);
            const av = document.getElementById('pmAvatar');
            if (av && data.avatar_seed) av.src = dicebearAvatar(data.avatar_seed);
        } else {
            const priv = res.status === 403;
            setText('pmAbout', '', priv ? 'This profile is private' : 'No description yet');
            setText('pmInterests', '', priv ? '' : 'No interests added yet');
            const c = document.getElementById('pmContacts');
            if (c) c.innerHTML = '';
        }
    } catch (_) {}

    // Games - same figure layout as the profile page (icon + name).
    try {
        const gres  = await fetch(`/api/user/games?user=${encodeURIComponent(username)}`, { credentials: 'same-origin' });
        const gdata = await gres.json().catch(() => ({}));
        const gel   = document.getElementById('pmGames');
        if (gel) {
            const games = (gdata && gdata.games) || [];
            if (!games.length) {
                gel.innerHTML = '<span class="empty-hint">No games added yet</span>';
            } else {
                gel.innerHTML = games.map((g, i) => `
                    <figure class="steam-game-figure ${i > 0 ? 'border-left' : ''}">
                        <div class="steam-icon">
                            <img src="${escMap(g.icon_url)}" alt="${escMap(g.name)}"
                                 style="width:100%;height:100%;object-fit:cover;border-radius:10px;"
                                 onerror="this.style.display='none'">
                        </div>
                        <figcaption>${escMap(g.name)}</figcaption>
                    </figure>`).join('');
            }
        }
    } catch (_) {}
}

// Clicking a Discord / Steam box opens the same popup style as the profile
// page (icon, label, selectable value, Copy button). Read-only here since
// you're viewing another player.
function ensureMapContactPopup() {
    let ov = document.getElementById('mapContactPopupOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'mapContactPopupOverlay';
    ov.className = 'contact-popup-overlay';
    ov.innerHTML = `
        <div class="contact-popup" id="mapContactPopupCard">
            <button class="contact-popup-close" id="mapContactPopupClose">X</button>
            <div class="contact-popup-icon" id="mapContactPopupIcon"></div>
            <p class="contact-popup-label" id="mapContactPopupLabel"></p>
            <input class="contact-popup-input" id="mapContactPopupInput" readonly>
            <div class="contact-popup-actions">
                <button class="contact-popup-copy" id="mapContactPopupCopy">Copy</button>
            </div>
            <p class="contact-popup-feedback" id="mapContactPopupFeedback"></p>
        </div>`;
    document.body.appendChild(ov);
    const close = () => ov.classList.remove('open');
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('#mapContactPopupCard').addEventListener('click', (e) => e.stopPropagation());
    ov.querySelector('#mapContactPopupClose').addEventListener('click', close);
    ov.querySelector('#mapContactPopupCopy').addEventListener('click', mapCopyContact);
    return ov;
}
// Öppnar popup-fönstret och visar spelarens kontaktinformation (Discord eller Steam).

function openMapContactPopup(kind, label, value) {
    const ov = ensureMapContactPopup();
    ov.querySelector('#mapContactPopupIcon').innerHTML = iconImg(kind === 'discord' ? 'discord' : 'steam');
    ov.querySelector('#mapContactPopupLabel').textContent = label;
    const inp = ov.querySelector('#mapContactPopupInput');
    inp.value = value || '';
    const copyBtn = ov.querySelector('#mapContactPopupCopy');
    copyBtn.textContent = 'Copy';
    copyBtn.classList.remove('copied');
    copyBtn.style.display = value ? 'block' : 'none';
    ov.querySelector('#mapContactPopupFeedback').textContent = '';
    ov.classList.add('open');
    setTimeout(() => { inp.focus(); if (value) inp.select(); }, 80);
}

async function mapCopyContact() {
    const ov       = document.getElementById('mapContactPopupOverlay');
    const inp      = ov.querySelector('#mapContactPopupInput');
    const copyBtn  = ov.querySelector('#mapContactPopupCopy');
    const feedback = ov.querySelector('#mapContactPopupFeedback');
    try { await navigator.clipboard.writeText(inp.value); }
    catch (_) { inp.select(); document.execCommand('copy'); }
    copyBtn.textContent  = '✓ Copied!';
    copyBtn.classList.add('copied');
    feedback.textContent = 'Copied to clipboard';
    feedback.style.color = '#39d98a';
    setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
        feedback.textContent = '';
    }, 2000);
}

document.addEventListener('click', (e) => {
    const box = e.target.closest('[data-pm-kind]');
    if (!box) return;
    openMapContactPopup(box.dataset.pmKind, box.dataset.pmLabel, box.dataset.pmValue);
});

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

    // Owner sees a delete button; everyone else sees "Chat Now".
    const isOwner = window.myUserId != null && player.id === window.myUserId;
    const actionBtn = isOwner
        ? `<button class="event-popup-delete" onclick="window._deleteMyEvent()">Delete Event</button>`
        : `<button class="event-popup-chat" onclick="window.location.href='/chat?user=${encodeURIComponent(player.gamertag)}'">Chat Now</button>`;

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
                ${actionBtn}
            </div>`)
        .addClassName('event-map-popup')
        .addTo(map);
}

// Deletes the current user's event (used by the owner's popup and the
// "replace existing event" flow). Returns true on success.
async function deleteMyEvent(confirmFirst = true) {
    if (confirmFirst && !confirm('Delete your event?')) return false;
    try {
        const res  = await fetch('/api/events/mine', { method: 'DELETE', credentials: 'same-origin' });
        let data;
        try { data = await res.json(); }
        catch { data = { success: false, error: `Server returned ${res.status} (route not found - restart the server?)` }; }
        if (!res.ok || !data.success) { alert(data.error || 'Could not delete event.'); return false; }
        // Drop it locally and refresh the map + list immediately.
        activeEvents = activeEvents.filter(e => e.playerId !== window.myUserId);
        closeAllPopups();
        refreshEventMarkers?.();
        renderEventList?.();
        loadAdminEvents?.();
        return true;
    } catch (e) {
        alert('Could not delete event.');
        return false;
    }
}
window._deleteMyEvent = () => deleteMyEvent(true);


//  Event list (bottom-center button, opens UPWARD) 
//  Lists every active map event, sorted nearest → farthest from the
//  current user (falls back to the map centre if our location is unknown).
//  Refreshes every 5 seconds.

function _eliEscape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Great-circle distance in km between two lat/lng points.
function _distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _fmtDistance(km) {
    if (!Number.isFinite(km)) return '-';
    if (km < 1)  return Math.round(km * 1000) + ' m';
    if (km < 10) return km.toFixed(1) + ' km';
    return Math.round(km) + ' km';
}

function initEventList() {
    const mapArea = document.querySelector('.map-area');
    if (!mapArea || document.getElementById('eventListToggle')) return;

    const toggle = document.createElement('button');
    toggle.id = 'eventListToggle';
    toggle.className = 'event-list-toggle';
    toggle.innerHTML = `<span class="elt-dot"></span><span>Events</span><span class="elt-count" id="eventListCount">0</span>`;
    mapArea.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'eventListPanel';
    panel.className = 'event-list-panel';
    panel.innerHTML = `
        <div class="event-list-header">
            <span class="event-list-title">Live Events</span>
            <span class="event-list-sub">Nearest first</span>
        </div>
        <div class="event-list-body" id="eventListBody"></div>`;
    mapArea.appendChild(panel);

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = panel.classList.toggle('open');
        toggle.classList.toggle('active', open);
        if (open) renderEventList();
    });

    // Click outside closes the panel.
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && !toggle.contains(e.target)) {
            panel.classList.remove('open');
            toggle.classList.remove('active');
        }
    });

    renderEventList();
    setInterval(renderEventList, 5000);
}

function renderEventList() {
    const body    = document.getElementById('eventListBody');
    const countEl = document.getElementById('eventListCount');
    if (!body) return;

    const players = window.currentPlayersForMap();

    // Reference point: our own marker if we can find it, else the map centre.
    let ref = null;
    if (window.myUserId != null) {
        const me = players.find(p => p.id === window.myUserId);
        if (me && Number.isFinite(me.lat) && Number.isFinite(me.lng)) ref = { lat: me.lat, lng: me.lng };
    }
    if (!ref) { const c = map.getCenter(); ref = { lat: c.lat, lng: c.lng }; }

    const rows = activeEvents.map(evt => {
        if (!isEventLive(evt)) return null;   // scheduled-but-not-started events stay hidden
        const player = players.find(p => p.id === evt.playerId);
        if (!player) return null;
        const dist = _distanceKm(ref.lat, ref.lng, player.lat, player.lng);
        return { evt, player, dist };
    }).filter(Boolean).sort((a, b) => a.dist - b.dist);

    if (countEl) countEl.textContent = rows.length;

    if (rows.length === 0) {
        body.innerHTML = '<div class="event-list-empty">No live events right now</div>';
        return;
    }

    body.innerHTML = rows.map((r, i) => {
        const { evt, player } = r;
        const avatar = dicebearAvatar(player.avatarSeed || player.gamertag);
        const timeStr = evt.hasEnd
            ? `${fmtTime(evt.startHour, evt.startMin, evt.startAmPm)} – ${fmtTime(evt.endHour, evt.endMin, evt.endAmPm)}`
            : `${fmtTime(evt.startHour, evt.startMin, evt.startAmPm)} · 2hr`;
        return `
            <div class="event-list-item" data-idx="${i}">
                <img class="eli-avatar" src="${avatar}" alt="">
                <div class="eli-main">
                    <div class="eli-top">
                        <span class="eli-event">${_eliEscape(evt.eventName) || 'Event'}</span>
                        <span class="eli-dist">${_fmtDistance(r.dist)}</span>
                    </div>
                    <div class="eli-sub">${_eliEscape(evt.gameName)} · ${_eliEscape(player.gamertag)}</div>
                    <div class="eli-time">${timeStr}</div>
                </div>
            </div>`;
    }).join('');

    body.querySelectorAll('.event-list-item').forEach(el => {
        el.addEventListener('click', () => {
            const r = rows[Number(el.dataset.idx)];
            if (!r) return;
            document.getElementById('eventListPanel')?.classList.remove('open');
            document.getElementById('eventListToggle')?.classList.remove('active');
            map.flyTo({ center: [r.player.lng, r.player.lat], zoom: Math.max(map.getZoom(), 14), essential: true });
            showEventPopup(r.player, r.evt);
        });
    });
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
        case 'settings': openModalPage('/settings'); break;     
        case 'login':         isLoggedIn ? handleLogout() : openModalPage('/login'); break;
        case 'settings': openModalPage('/settings', true); break;       
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
    const players = window.currentPlayersForMap();
    const counts = { all: players.length, malmo: 0, goteborg: 0, stockholm: 0 };

    players.forEach(p => {
        if (counts[p.location] !== undefined) counts[p.location]++;
    });

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
    setInterval(() => { sendMapPresence(); }, 8000);
    checkAdmin();         // show admin panel for admins
    initEventSystem();    // event creation button + form
    initEventList();      // bottom-center "Events" list (nearest → farthest)
    initCustomSelects();  // custom glassy dropdowns
    initMapWebSocket();

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
let activeEvents = [];

// Single source of truth for "is this event running right now?"
// now must be at/after start and before end. Used by the marker click,
// the event list, and the pulse rings so they all agree on timing.
function isEventLive(evt, now = Date.now()) {
    if (!evt) return false;
    if (evt.startMs != null && now < evt.startMs) return false;
    if (evt.endMs   != null && now >= evt.endMs)  return false;
    return true;
}

async function loadActiveEventsFromServer() {
    try {
        const res = await fetch('/api/events/active', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success) return;

        activeEvents = (data.events || []).map(ev => {
            let startHour = 8, startMin = 0, startAmPm = 'PM';
            if (ev.datetime) {
                const d = new Date(ev.datetime);
                const h24 = d.getHours();
                startMin = d.getMinutes();
                startAmPm = h24 >= 12 ? 'PM' : 'AM';
                startHour = (h24 % 12) || 12;
            }
            return {
                id: ev.id,
                playerId: ev.creator_id,
                eventName: ev.title,
                gameName: ev.game_name || `App ${ev.appid}`,
                startHour, startMin, startAmPm,
                startMs: ev.datetime ? new Date(ev.datetime).getTime() : null,
                endMs:   ev.end_time ? new Date(ev.end_time).getTime() : null,
                hasEnd: false
            };
        });
    } catch (_) {}
}



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
    const addBtn = document.createElement('button');
    addBtn.className = 'event-add-btn';
    addBtn.innerHTML = '+';
    addBtn.title = 'Create Event';
    mapArea.appendChild(addBtn);

    addBtn.onclick = () => window.openDynamicEventForm();

    window.openDynamicEventForm = function () {
        if (!isLoggedIn) {
            alert('Please login first to create an event');
            openModalPage('/login');
            return;
        }
        if (document.getElementById('eventFormOverlay')) return;

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
            const t = (total + add) % 1440;
            const h24 = Math.floor(t / 60);
            return { h12: h24 % 12 || 12, m: t % 60, ap: h24 >= 12 ? 'PM' : 'AM' };
        }

        const seed = nowRounded();
        const endSeed = addMins(seed.totalMins, 120);
        const endMr = Math.round(endSeed.m / 5) * 5 % 60;

        // Overlay
        const overlay = document.createElement('div');
        overlay.className = 'event-form-overlay show';
        overlay.id = 'eventFormOverlay';
        overlay.innerHTML = `
            <div class="event-form-card">
                <button class="event-form-close" id="eventFormClose">X</button>

                <div class="event-form-title">Create Event</div>
                <div class="event-form-subtitle">Let nearby players find and join you</div>
                <div class="event-form-error" id="eventFormError" style="color:#fca5a5; display:none; font-size:13px; margin-bottom:10px;"></div>

                <div class="event-field">
                    <label>Event Name *</label>
                    <input class="event-input" id="evtName" type="text" placeholder="e.g. Friday Ranked Grind">
                </div>

                <div class="event-field" style="position: relative;">
                    <label>Game (Steam Live Search) *</label>
                    <input class="event-input" id="evtGame" type="text" placeholder="e.g. Valorant, CS2, Minecraft">
                    <input type="hidden" id="evtAppid" value="">
                    <div id="evtSteamResults" class="steam-results" style="display:none; position:absolute; width:100%; max-height:200px; overflow-y:auto; z-index:1000; background:#1e1f22; border:1px solid rgba(155,89,182,0.4); border-radius:8px; margin-top:5px;"></div>
                </div>

                <div class="event-field">
                    <label>Description</label>
                    <textarea class="edit-input" id="evtDesc" rows="2"
                        placeholder="What are we doing?"
                        style="width:100%; font-family:inherit; background:rgba(30,31,34,0.7); border:1px solid rgba(255,255,255,0.1); color:#fff; padding:8px; border-radius:6px; resize:none;"></textarea>
                </div>

                <div style="display:flex; gap:10px;">
                    <div class="event-field" style="flex:1;">
                        <label>Min Rank</label>
                        <input class="event-input" id="evtMinRank" type="text" placeholder="e.g. Gold">
                    </div>
                    <div class="event-field" style="flex:1;">
                        <label>Max Rank</label>
                        <input class="event-input" id="evtMaxRank" type="text" placeholder="e.g. Global">
                    </div>
                </div>

                <div class="event-field">
                    <label>Start Time *</label>
                    <div id="evtStartPicker"></div>
                </div>

                <div class="event-field">
                    <label>End Time <span class="event-label-note">(optional)</span></label>
                    <div id="evtEndPicker"></div>
                    <p class="event-field-note" style="font-size:11px; color:#aaa; margin-top:4px;">
                        Leave unchanged and the event auto-closes after 2 hours.
                    </p>
                </div>

                <button class="event-submit-btn" id="eventSubmitBtn" style="margin-top:15px;">Start Event</button>
            </div>
        `;
        mapArea.appendChild(overlay);

        const startPicker = buildTimePicker(seed.h12, seed.m, seed.ap);
        const endPicker = buildTimePicker(endSeed.h12, endMr, endSeed.ap);
        document.getElementById('evtStartPicker').appendChild(startPicker.el);
        document.getElementById('evtEndPicker').appendChild(endPicker.el);

        const closeBtn = document.getElementById('eventFormClose');
        const gameInput = document.getElementById('evtGame');
        const resultsDiv = document.getElementById('evtSteamResults');
        const submitBtn = document.getElementById('eventSubmitBtn');
        const appidInput = document.getElementById('evtAppid');
        const errorDiv = document.getElementById('eventFormError');

        closeBtn.onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        // Steam live search
        let searchTimer = null;
        gameInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const query = gameInput.value.trim();

            if (query.length < 2) {
                resultsDiv.innerHTML = '';
                resultsDiv.style.display = 'none';
                appidInput.value = '';
                return;
            }

            searchTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/steam/search?q=${encodeURIComponent(query)}`);
                    const data = await res.json();

                    resultsDiv.style.display = 'block';
                    if (data.success && (data.results || []).length > 0) {
                        resultsDiv.innerHTML = data.results.map(game => {
                            const escapedName = String(game.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                            return `
                                <div class="steam-result-row"
                                     style="padding:8px; display:flex; align-items:center; gap:10px; cursor:pointer;"
                                     onclick="selectSteamGameForEvent(${game.appid}, '${escapedName}')">
                                    <img src="${game.icon_url}" width="32" height="32" style="border-radius:4px; object-fit:cover;">
                                    <div style="font-size:14px; color:#fff;">${game.name}</div>
                                </div>`;
                        }).join('');
                    } else {
                        resultsDiv.innerHTML = '<div style="padding:8px; color:#aaa; font-size:12px;">No games found</div>';
                    }
                } catch (err) {
                    console.error('Steam search error:', err);
                }
            }, 400);
        });

        window.selectSteamGameForEvent = function (appid, name) {
            gameInput.value = name;
            appidInput.value = appid;
            resultsDiv.innerHTML = '';
            resultsDiv.style.display = 'none';
        };

        document.addEventListener('click', (e) => {
            if (e.target !== gameInput && e.target !== resultsDiv) {
                resultsDiv.style.display = 'none';
            }
        });

        // Submit -> backend
        submitBtn.onclick = async () => {
            const title = document.getElementById('evtName').value.trim();
            const appid = appidInput.value;
            const description = document.getElementById('evtDesc').value.trim();
            const min_rank = document.getElementById('evtMinRank').value.trim();
            const max_rank = document.getElementById('evtMaxRank').value.trim();

            if (!title || !appid) {
                errorDiv.textContent = 'Please fill in Event Name and select a game from the Steam list.';
                errorDiv.style.display = 'block';
                return;
            }

            const startH = startPicker.getHour(), startM = startPicker.getMin(), startAp = startPicker.getAmPm();
            const endH = endPicker.getHour(), endM = endPicker.getMin(), endAp = endPicker.getAmPm();

            const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
            const startMins = to24mins(startH, startM, startAp);
            if (startMins < nowMins) {
                errorDiv.textContent = 'Start time is in the past.';
                errorDiv.style.display = 'block';
                return;
            }

            const endMins = to24mins(endH, endM, endAp);
            const hasEnd = !(endH === endSeed.h12 && endM === endMr && endAp === endSeed.ap);
            if (hasEnd && endMins <= startMins) {
                errorDiv.textContent = 'End time must be after the start time.';
                errorDiv.style.display = 'block';
                return;
            }

            errorDiv.style.display = 'none';

            const now = new Date();
            const startHour24 = (startAp === 'AM')
                ? (startH === 12 ? 0 : startH)
                : (startH === 12 ? 12 : startH + 12);

            const startDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
                startHour24,
                startM
            );

            let endIso = null;
            if (hasEnd) {
                const endHour24 = (endAp === 'AM')
                    ? (endH === 12 ? 0 : endH)
                    : (endH === 12 ? 12 : endH + 12);
                const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHour24, endM);
                if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1); // crosses midnight
                endIso = endDate.toISOString();
            }

            const payload = {
                title,
                appid: parseInt(appid, 10),
                datetime: startDate.toISOString(),
                end_time: endIso,
                description,
                min_rank: min_rank || null,
                max_rank: max_rank || null
            };

            try {
                const postEvent = () => fetch('/create_event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                let response = await postEvent();
                let resData  = await response.json();

                // 409 = the user already has an active/scheduled event.
                // Offer to delete it and create this one instead.
                if (response.status === 409) {
                    const replace = confirm(
                        (resData.error || 'You already have an event.') +
                        '\n\nDelete your existing event and create this new one?'
                    );
                    if (!replace) {
                        errorDiv.textContent = resData.error || 'You already have an event.';
                        errorDiv.style.display = 'block';
                        return;
                    }
                    const deleted = await deleteMyEvent(false); // no extra confirm
                    if (!deleted) {
                        errorDiv.textContent = 'Could not delete your existing event.';
                        errorDiv.style.display = 'block';
                        return;
                    }
                    response = await postEvent();   // retry now that the old one is gone
                    resData  = await response.json();
                }

                if (!response.ok) {
                    errorDiv.textContent = resData.error || 'Failed to create event.';
                    errorDiv.style.display = 'block';
                    return;
                }

                const myId = window.myUserId;
                if (!myId) { alert('Missing user id'); return; }

                // Local copy must carry start/end ms so its ring obeys the active
                // window too (a future event should not ring until it starts).
                const localEndMs = hasEnd
                    ? (endIso ? new Date(endIso).getTime() : null)
                    : (startDate.getTime() + 2 * 60 * 60 * 1000);

                activeEvents = activeEvents.filter(e => e.playerId !== myId);
                activeEvents.push({
                    playerId: myId,
                    eventName: title,
                    gameName: gameInput.value.trim(),
                    startHour: startH,
                    startMin: startM,
                    startAmPm: startAp,
                    startMs: startDate.getTime(),
                    endMs: localEndMs,
                    hasEnd,
                    endHour: endH,
                    endMin: endM,
                    endAmPm: endAp
                });

                overlay.remove();
                refreshEventMarkers?.();
                loadAdminEvents?.();
                alert('Event created successfully!');
            } catch (err) {
                errorDiv.textContent = err.message || 'Server error connection failed.';
                errorDiv.style.display = 'block';
            }
        };
    };

    // Draw initial rings when markers exist
    map.on('load', () => setTimeout(refreshEventMarkers, 500));
    if (map.loaded()) setTimeout(refreshEventMarkers, 300);

    // Re-check periodically so a scheduled event's ring switches on at its
    // start time (and off at its end) without needing a page refresh.
    setInterval(() => refreshEventMarkers?.(), 5000);
}


// Redraws pulse rings on all players who currently have an active event.
// Rings are injected into the avatar marker element so they stay centred on pan/zoom.
function refreshEventMarkers() {
    // Clear all existing pulse rings
    Object.values(playerMarkers).forEach(({ el }) => el.querySelectorAll('.pulse-ring').forEach(r => r.remove()));
    Object.values(pulseMarkers).forEach(m => { try { m.remove(); } catch (e) {} });
    Object.keys(pulseMarkers).forEach(k => delete pulseMarkers[k]);

    activeEvents.forEach(evt => {
        // Ring only shows while the event is actually running (same check the
        // marker click and the list use). Scheduled events draw no ring yet.
        if (!isEventLive(evt)) return;

        const player = window.currentPlayersForMap().find(p => p.id === evt.playerId);
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
function spreadOverlappingPlayers(players) {
    const seen = new Map(); // "lat,lng" -> count
    return players.map(p => {
        const key = `${p.lat},${p.lng}`;
        const i = (seen.get(key) || 0);
        seen.set(key, i + 1);
        if (i === 0) return p;

        // liten offset i "cirkel" runt punkten (~5–20 meter)
        const r = 0.00012 * Math.ceil(i / 6);
        const a = (i % 6) * (Math.PI * 2 / 6);
        return {
            ...p,
            lat: p.lat + Math.sin(a) * r,
            lng: p.lng + Math.cos(a) * r,
        };
    });
}


function initMapWebSocket() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/map`);

    ws.onmessage = async (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        if (msg.type !== 'players_snapshot') return;

        const incoming = msg.players || [];

        const cleaned = incoming
            .map(p => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }))
            .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

        if (cleaned.length !== incoming.length) {
                console.warn(
                    '[ws] dropped players with invalid coords',
                    incoming.filter(p => !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng)))
            );
            }

        window.livePlayers = spreadOverlappingPlayers(
        cleaned.map(p => ({ ...p, mapVisible: true }))
            );
        updateLocationCounts();
        renderMapMarkers(window.currentPlayersForMap());
        await loadActiveEventsFromServer();

        refreshEventMarkers?.();
    };

    ws.onerror = (e) => console.warn('[map ws] error', e);
    ws.onclose = (e) => console.warn('[map ws] closed', e.code, e.reason);
}