// app.js GameScape
// MERGED: new version used as base.
// profile visibility toggle, full chat system (auto-connect WebSocket,
// typing indicators, user search dropdown, mobile panel switching).
// Each init function checks for a key element before running safe to load on every page.


//  Shared helpers 

// Safely escapes a string for use in innerHTML. We let the browser do the escaping
// by assigning as textContent (which is always treated as plain text) and reading
// back innerHTML (which gives us the escaped version with &, <, > converted).
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


// ══════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════

function initLogin() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const btn      = document.getElementById('loginBtn');
        const errorMsg = document.getElementById('errorMsg');

        btn.textContent        = 'Signing in...';
        btn.disabled           = true;
        errorMsg.style.display = 'none';

        const payload = {
            username_or_email: document.getElementById('username_or_email').value.trim(),
            password:          document.getElementById('password').value,
        };

        try {
            const res  = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload),
            });
            const data = await res.json();

            if (data.success) {
                // Login/register run inside an iframe modal. window.parent reaches the map page,
                // which exposes setLoggedIn and checkAdmin globally so the iframe can trigger
                // state updates on the parent without a full page reload.
                if (window.parent && window.parent.setLoggedIn)
                    window.parent.setLoggedIn(true, data.username);
                // tell the parent to refresh the admin panel after login
                if (window.parent && window.parent.checkAdmin)
                    window.parent.checkAdmin();
                window.parent.closeModalPage();
            } else {
                errorMsg.textContent   = data.error || 'Login failed';
                errorMsg.style.display = 'block';
                btn.textContent        = 'Sign In';
                btn.disabled           = false;
            }
        } catch (err) {
            errorMsg.textContent   = 'Network error – please try again';
            errorMsg.style.display = 'block';
            btn.textContent        = 'Sign In';
            btn.disabled           = false;
        }
    });
}


// ══════════════════════════════════════════════════════════
//  REGISTER
// ══════════════════════════════════════════════════════════

function initRegister() {
    const form = document.getElementById('registerForm');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const btn      = document.getElementById('registerBtn');
        const errorMsg = document.getElementById('errorMsg');

        btn.textContent        = 'Creating account...';
        btn.disabled           = true;
        errorMsg.style.display = 'none';

        const genderInput = document.querySelector('input[name="gender"]:checked');
        const payload = {
            username:         document.getElementById('username').value.trim(),
            password:         document.getElementById('password').value,
            confirm_password: document.getElementById('confirm_password').value,
            full_name:        document.getElementById('full_name').value.trim(),
            email:            document.getElementById('email').value.trim(),
            birthday:         document.getElementById('birthday').value,
            gender:           genderInput ? genderInput.value : '',
        };

        try {
            const res  = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(payload),
            });
            const data = await res.json();

            if (data.success) {
                if (window.parent && window.parent.setLoggedIn)
                    window.parent.setLoggedIn(true, data.username);
                window.parent.closeModalPage();
            } else {
                errorMsg.textContent   = data.error || 'Registration failed';
                errorMsg.style.display = 'block';
                btn.textContent        = 'Register';
                btn.disabled           = false;
            }
        } catch (err) {
            errorMsg.textContent   = 'Network error – please try again';
            errorMsg.style.display = 'block';
            btn.textContent        = 'Register';
            btn.disabled           = false;
        }
    });
}


// ══════════════════════════════════════════════════════════
//  PROFILE + STEAM + VISIBILITY TOGGLE
// ══════════════════════════════════════════════════════════

let editMode       = false;
let profileData    = { about_me: '', interests: '', discord: '', steam_username: '' };
let dbColumnsExist = false;
let userGames      = [];

// (interests are rendered as plain text no icon SVG needed)

function initProfile() {
    if (!document.getElementById('profileName')) return;
    loadProfile().then(() => initVisibilityToggle()).catch(() => initVisibilityToggle());
    // Fallback in case loadProfile doesn't call then()
    setTimeout(initVisibilityToggle, 400);
}

async function loadProfile() {
    try {
        const res  = await fetch('/api/me', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.logged_in) {
            document.getElementById('profileName').textContent = 'Not logged in';
            return;
        }
        document.getElementById('profileName').textContent = data.username;
        document.getElementById('profileAvatar').src =
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.username)}`;

        await loadUserGames();

        try {
            const profRes  = await fetch('/api/profile', { credentials: 'same-origin' });
            const profData = await profRes.json();
            if (profData.success) {
                dbColumnsExist = true;
                profileData    = {
                    about_me:       profData.about_me       || '',
                    interests:      profData.interests      || '',
                    discord:        profData.discord        || '',
                    steam_username: profData.steam_username || '',
                };
                renderView();
            }
        } catch (_) {}

    } catch (e) {
        document.getElementById('profileName').textContent = 'Could not load profile';
    }
}

async function loadUserGames() {
    try {
        const res  = await fetch('/api/user/games', { credentials: 'same-origin' });
        const data = await res.json();
        if (data.success) { userGames = data.games; renderGamesView(); }
    } catch (_) {}
}

function renderGamesView() {
    const el = document.getElementById('gamesView');
    if (!el) return;
    if (userGames.length === 0) {
        el.innerHTML = '<span class="empty-hint">No games added yet</span>';
        return;
    }
    el.innerHTML = userGames.map((g, i) => `
        <figure class="steam-game-figure ${i > 0 ? 'border-left' : ''}">
            <div class="steam-icon">
                <img src="${escapeHtml(g.icon_url)}" alt="${escapeHtml(g.name)}"
                     style="width:100%;height:100%;object-fit:cover;border-radius:10px;"
                     onerror="this.style.display='none'">
            </div>
            <figcaption>${escapeHtml(g.name)}</figcaption>
        </figure>`).join('');
}

function renderGamesEdit() {
    const el = document.getElementById('gamesEditList');
    if (!el) return;
    if (userGames.length === 0) {
        el.innerHTML = '<p class="empty-hint" style="font-size:11px;margin-bottom:6px;">No games yet</p>';
        return;
    }
    el.innerHTML = userGames.map(g => `
        <div class="edit-game-row">
            <div class="steam-icon" style="width:28px;height:28px;flex-shrink:0;">
                <img src="${escapeHtml(g.icon_url)}" alt=""
                     style="width:100%;height:100%;object-fit:cover;border-radius:6px;"
                     onerror="this.style.display='none'">
            </div>
            <span class="edit-game-name">${escapeHtml(g.name)}</span>
            <button class="edit-game-remove" onclick="removeGame(${g.appid})">✕</button>
        </div>`).join('');
}

async function removeGame(appid) {
    try {
        await fetch(`/api/user/games/${appid}`, { method: 'DELETE', credentials: 'same-origin' });
        userGames = userGames.filter(g => g.appid !== appid);
        renderGamesEdit();
        renderGamesView();
    } catch (_) {}
}

function renderView() {
    // About Me
    const aboutEl = document.getElementById('aboutView');
    if (aboutEl) {
        aboutEl.textContent = profileData.about_me || 'No description yet';
        aboutEl.className   = profileData.about_me ? 'about-text' : 'about-text empty-hint';
    }

    // Interests plain text, no icon grid
    const intEl = document.getElementById('interestsView');
    if (intEl) {
        intEl.textContent = profileData.interests || 'No interests added yet';
        intEl.className   = profileData.interests ? 'about-text' : 'about-text empty-hint';
    }

    // Discord contact box
    const discordValEl = document.getElementById('discordView');
    if (discordValEl) {
        discordValEl.textContent = profileData.discord || 'Not set';
        discordValEl.className   = profileData.discord ? 'contact-box-value' : 'contact-box-value not-set';
    }

    // Steam contact box
    const steamValEl = document.getElementById('steamUsernameView');
    if (steamValEl) {
        steamValEl.textContent = profileData.steam_username || 'Not set';
        steamValEl.className   = profileData.steam_username ? 'contact-box-value' : 'contact-box-value not-set';
    }
}

function toggleEdit() {
    editMode = !editMode;
    const pairs = [
        ['aboutView',      'aboutEdit'],
        ['interestsView',  'interestsEdit'],
    ];
    pairs.forEach(([viewId, editId]) => {
        const v = document.getElementById(viewId);
        const e = document.getElementById(editId);
        if (v) v.style.display = editMode ? 'none' : '';
        if (e) e.style.display = editMode ? 'block' : 'none';
    });

    // Games section swap
    const gv = document.getElementById('gamesView');
    const ge = document.getElementById('gamesEdit');
    if (gv) gv.style.display = editMode ? 'none' : '';
    if (ge) ge.style.display = editMode ? 'block' : 'none';

    if (editMode) {
        const aboutEdit = document.getElementById('aboutEdit');
        const intInput  = document.getElementById('interestsInput');
        if (aboutEdit) aboutEdit.value = profileData.about_me  || '';
        if (intInput)  intInput.value  = profileData.interests || '';
        renderGamesEdit();
    }

    const saveBtn = document.getElementById('saveBtn');
    const editBtn = document.getElementById('editBtn');
    if (saveBtn) saveBtn.style.display    = editMode ? 'block' : 'none';
    if (editBtn) editBtn.style.background = editMode ? 'rgba(155,89,182,0.3)' : 'rgba(30,31,34,0.6)';
}

async function saveProfile() {
    const payload = {
        about_me:       document.getElementById('aboutEdit')?.value.trim()      || '',
        interests:      document.getElementById('interestsInput')?.value.trim() || '',
        // discord and steam_username are saved via their own popup, not here
        discord:        profileData.discord        || '',
        steam_username: profileData.steam_username || '',
    };
    // Don't save if nothing changed
    if (!payload.about_me && !payload.interests
        && !profileData.about_me && !profileData.interests) {
        toggleEdit();
        return;
    }

    const saveBtn = document.getElementById('saveBtn');
    const origText = saveBtn?.textContent;
    if (saveBtn) { saveBtn.textContent = 'Saving…'; saveBtn.disabled = true; }

    try {
        const res  = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.success) {
            profileData.about_me       = payload.about_me;
            profileData.interests      = payload.interests;
            profileData.discord        = payload.discord;
            profileData.steam_username = payload.steam_username;
            renderView();
            toggleEdit();
        } else {
            showProfileError(data.error || 'Could not save profile');
            if (saveBtn) { saveBtn.textContent = origText; saveBtn.disabled = false; }
        }
    } catch (e) {
        showProfileError('Network error could not save profile');
        if (saveBtn) { saveBtn.textContent = origText; saveBtn.disabled = false; }
    }
}

// Shows an error message inside the profile card (no browser alert).
function showProfileError(msg) {
    let errEl = document.getElementById('profileSaveError');
    if (!errEl) {
        errEl = document.createElement('p');
        errEl.id = 'profileSaveError';
        errEl.style.cssText = 'font-size:11px;color:#fca5a5;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:8px 12px;margin-top:8px;text-align:center;';
        document.getElementById('saveBtn')?.insertAdjacentElement('afterend', errEl);
    }
    errEl.textContent = msg;
    errEl.style.display = 'block';
    setTimeout(() => { if (errEl) errEl.style.display = 'none'; }, 5000);
}

// Logs the user out from the profile modal.
// Calls /api/logout, notifies the parent map page, then closes the modal.
async function logoutUser() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (_) {}
    // Tell the parent map page to update its login state and admin panel
    if (window.parent && window.parent.setLoggedIn) window.parent.setLoggedIn(false, null);
    if (window.parent && window.parent.checkAdmin)  window.parent.checkAdmin();
    window.parent.closeModalPage();
}


//  Contact copy popup 
// Opens a small popup with the Discord or Steam value pre-selected so the
// user can click Copy (or just Ctrl+C immediately).

const CONTACT_META = {
    discord: {
        label: 'Discord',
        placeholder: 'e.g. gamer#1234 or gamer',
        icon:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`,
    },
    steam: {
        label: 'Steam',
        placeholder: 'e.g. GameScape99',
        icon:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.879L2 12.184V12C2 6.477 6.477 2 12 2zm0 0c5.523 0 10 4.477 10 10s-4.477 10-10 10a9.956 9.956 0 0 1-5.406-1.587l3.29-1.362A3.5 3.5 0 1 0 13.5 13.5v-.043l-3.26 2.367A3.501 3.501 0 0 0 6.5 13.5a3.499 3.499 0 0 0 3.063 3.474l-1.85.766A8.001 8.001 0 0 1 4 12c0-4.418 3.582-8 8-8z"/></svg>`,
    },
};

let _contactPopupType = null;

function openContactPopup(type) {
    _contactPopupType = type;
    const value = type === 'discord' ? profileData.discord : profileData.steam_username;
    const meta  = CONTACT_META[type];

    document.getElementById('contactPopupIcon').innerHTML    = meta.icon;
    document.getElementById('contactPopupLabel').textContent = meta.label;
    document.getElementById('contactPopupFeedback').textContent = '';

    const inp = document.getElementById('contactPopupInput');
    inp.value       = value || '';
    inp.readOnly    = false;
    inp.placeholder = meta.placeholder || '';

    const copyBtn = document.getElementById('contactPopupCopyBtn');
    copyBtn.textContent = 'Copy';
    copyBtn.classList.remove('copied');
    copyBtn.style.display = value ? 'block' : 'none';

    document.getElementById('contactPopupOverlay').classList.add('open');
    setTimeout(() => { inp.focus(); if (value) inp.select(); }, 80);
}

function closeContactPopup() {
    document.getElementById('contactPopupOverlay')?.classList.remove('open');
    _contactPopupType = null;
}

async function saveContact() {
    const inp      = document.getElementById('contactPopupInput');
    const feedback = document.getElementById('contactPopupFeedback');
    const saveBtn  = document.getElementById('contactPopupSaveBtn');
    const copyBtn  = document.getElementById('contactPopupCopyBtn');
    const newValue = inp.value.trim();

    if (_contactPopupType === 'discord')    profileData.discord        = newValue;
    else                                    profileData.steam_username = newValue;

    const origText      = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';
    saveBtn.disabled    = true;

    try {
        const res  = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                about_me:       profileData.about_me       || '',
                interests:      profileData.interests      || '',
                discord:        profileData.discord        || '',
                steam_username: profileData.steam_username || '',
            }),
        });
        const data = await res.json();
        if (data.success) {
            feedback.textContent  = '✓ Saved!';
            feedback.style.color  = '#39d98a';
            copyBtn.style.display = newValue ? 'block' : 'none';
            renderView();
            setTimeout(closeContactPopup, 900);
        } else {
            feedback.textContent = data.error || 'Could not save';
            feedback.style.color = '#fca5a5';
        }
    } catch (_) {
        feedback.textContent = 'Network error';
        feedback.style.color = '#fca5a5';
    }
    saveBtn.textContent = origText;
    saveBtn.disabled    = false;
}

async function copyContact() {
    const inp      = document.getElementById('contactPopupInput');
    const copyBtn  = document.getElementById('contactPopupCopyBtn');
    const feedback = document.getElementById('contactPopupFeedback');
    try {
        await navigator.clipboard.writeText(inp.value);
    } catch (_) {
        // navigator.clipboard requires a secure context (HTTPS) and user focus.
        // document.execCommand is the old fallback that still works over HTTP or
        // in browsers that block the Clipboard API.
        inp.select();
        document.execCommand('copy');
    }
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


//  Steam search modal 

let steamSearchTimer = null;

function openSteamModal() {
    const overlay = document.getElementById('steamModalOverlay');
    if (overlay) overlay.style.display = 'flex';
    const input = document.getElementById('steamSearchInput');
    if (input) { input.value = ''; input.focus(); }
    const results = document.getElementById('steamResults');
    if (results) results.innerHTML = '';
    const msg = document.getElementById('steamMsg');
    if (msg) msg.textContent = '';
}

function closeSteamModal() {
    const overlay = document.getElementById('steamModalOverlay');
    if (overlay) overlay.style.display = 'none';
}

function initSteamSearch() {
    const input = document.getElementById('steamSearchInput');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(steamSearchTimer);
        const q = input.value.trim();
        if (q.length < 2) { document.getElementById('steamResults').innerHTML = ''; return; }
        document.getElementById('steamMsg').textContent = 'Searching...';
        steamSearchTimer = setTimeout(() => doSteamSearch(q), 400);
    });
    document.getElementById('steamModalOverlay')
        ?.addEventListener('click', (e) => { if (e.target.id === 'steamModalOverlay') closeSteamModal(); });
}

async function doSteamSearch(q) {
    try {
        const res  = await fetch(`/api/steam/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
        const data = await res.json();
        const msg  = document.getElementById('steamMsg');
        const list = document.getElementById('steamResults');
        msg.textContent = '';
        if (!data.success || data.results.length === 0) {
            list.innerHTML = '<div class="steam-no-results">No results found</div>';
            return;
        }
        list.innerHTML = data.results.map(g => `
            <div class="steam-result-row" onclick="addSteamGame(${g.appid},'${escapeHtml(g.name).replace(/'/g,"\\'")}','${escapeHtml(g.icon_url).replace(/'/g,"\\'")}')">
                <img src="${escapeHtml(g.icon_url)}" alt="" width="40" height="40"
                     style="border-radius:8px;flex-shrink:0;object-fit:cover;"
                     onerror="this.style.visibility='hidden'">
                <div class="steam-result-info">
                    <div class="steam-result-name">${escapeHtml(g.name)}</div>
                    <div class="steam-result-appid">AppID: ${g.appid}</div>
                </div>
                <span class="steam-result-add">+ Add</span>
            </div>`).join('');
    } catch (e) {
        document.getElementById('steamMsg').textContent = 'Search failed';
    }
}

async function addSteamGame(appid, name, iconUrl) {
    const msg = document.getElementById('steamMsg');
    msg.textContent = `Adding ${name}...`;
    try {
        const res  = await fetch(`/api/steam/game/${appid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name, icon_url: iconUrl }),
        });
        const data = await res.json();
        if (data.success) {
            msg.textContent = `✓ ${name} added!`;
            if (!userGames.find(g => g.appid === appid)) {
                userGames.unshift(data.game);
                renderGamesView();
                if (editMode) renderGamesEdit();
            }
            setTimeout(() => { msg.textContent = ''; }, 2000);
        } else {
            msg.textContent = data.error || 'Failed to add';
        }
    } catch (e) {
        msg.textContent = 'Network error';
    }
}


//  Map visibility toggle (eye icon in profile) 
// Persisted in localStorage. Calls window.parent.setDemoVisible() to
// show/hide the logged-in user's demo marker on the map page.

const VISIBLE_KEY = 'gamescape_demo_visible';

// If the key has never been set we default to visible (true).
// localStorage always returns strings, so we compare to the string 'true'.
function getVisible() {
    const v = localStorage.getItem(VISIBLE_KEY);
    return v === null ? true : v === 'true';
}

function applyVisibilityUI(visible) {
    const eyeBtn = document.getElementById('visibilityBtn');
    if (!eyeBtn) return;
    eyeBtn.title = visible ? 'Hide me from map' : 'Show me on map';
    eyeBtn.style.background  = visible ? 'rgba(57,217,138,0.2)'  : 'rgba(30,31,34,0.6)';
    eyeBtn.style.borderColor = visible ? 'rgba(57,217,138,0.7)'  : 'rgba(155,89,182,0.3)';
    // Swap between open and closed eye SVG paths
    const svg = eyeBtn.querySelector('svg');
    if (svg) {
        svg.innerHTML = visible
            ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
            : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    }
}

function initVisibilityToggle() {
    const eyeBtn = document.getElementById('visibilityBtn');
    if (!eyeBtn) return;
    let visible = getVisible();
    applyVisibilityUI(visible);
    eyeBtn.addEventListener('click', () => {
        visible = !visible;
        localStorage.setItem(VISIBLE_KEY, String(visible));
        applyVisibilityUI(visible);
        // Notify the parent map page so the demo marker updates immediately
        if (window.parent && window.parent.setDemoVisible)
            window.parent.setDemoVisible(visible);
    });
}


// ══════════════════════════════════════════════════════════
//  CHAT  (FULLY RESTORED from old chat.js)
//  Key improvements over the old new version:
//  - Auto-connects WebSocket on session load (no manual connect button)
//  - Typing indicator with debounce
//  - Unified search bar: filters contacts AND searches DB for new users
//  - Mobile panel switching (contacts ↔ conversation slide)
//  - Animated background blob
// ══════════════════════════════════════════════════════════

function initChat() {
    // Guard: only run on the chat page
    if (!document.getElementById('contactsList')) return;

    //  State 
    let chatSocket         = null;
    let currentUsername    = null;
    let currentChatPartner = null;
    let onlineUsers        = new Set();
    let messagesHistory    = {};
    let dbContacts         = [];
    let isLoggedIn         = false;
    let typingTimer        = null;
    let isSendingTyping    = false;
    let searchDebounce     = null;

    //  DOM refs 
    const statusSpan        = document.getElementById('connectionStatus');
    const contactsListDiv   = document.getElementById('contactsList');
    const messagesDiv       = document.getElementById('messagesContainer');
    const messageInput      = document.getElementById('messageInput');
    const sendBtn           = document.getElementById('sendBtn');
    const chatNameSpan      = document.getElementById('currentChatName');
    const searchInput       = document.getElementById('searchInput');
    const userSearchResults = document.getElementById('userSearchResults');
    const contactsPanel     = document.getElementById('contactsPanel');
    const conversationPanel = document.getElementById('conversationPanel');

    // animated background blob (second blob to complement body::after)
    const blob       = document.createElement('div');
    blob.className   = 'bg-blob';
    document.body.appendChild(blob);

    //  Mobile panel helpers 
    // On mobile only one panel is visible at a time.
    function showConversationPanel() {
        contactsPanel?.classList.add('panel-hidden');
        conversationPanel?.classList.add('panel-visible');
    }
    function showContactsPanel() {
        contactsPanel?.classList.remove('panel-hidden');
        conversationPanel?.classList.remove('panel-visible');
    }
    // Expose globally so the inline onclick in HTML can reach it
    window.showContactsPanel = showContactsPanel;

    //  Session check auto-connects WebSocket 
    async function checkLoginState() {
        try {
            const res  = await fetch('/api/me', { credentials: 'same-origin' });
            const data = await res.json();
            if (data.logged_in) {
                isLoggedIn      = true;
                currentUsername = data.username;
                statusSpan.textContent = `Connected as ${data.username}`;
                statusSpan.className   = 'status-online';
                await loadContactsFromDB();
                connectWebSocket(data.username);
            }
        } catch (e) { console.warn('Session check failed:', e); }
    }

    //  Database helpers 

    async function loadContactsFromDB() {
        try {
            const res  = await fetch('/api/chat/contacts', { credentials: 'same-origin' });
            const data = await res.json();
            if (data.success) { dbContacts = data.contacts; renderContacts(); }
        } catch (e) { console.warn('Failed to load contacts:', e); }
    }

    async function loadChatHistory(partner) {
        try {
            const res  = await fetch(`/api/chat/history/${encodeURIComponent(partner)}`, { credentials: 'same-origin' });
            const data = await res.json();
            if (data.success) {
                messagesHistory[partner] = data.messages.map(m => ({
                    from: m.from, to: m.from === currentUsername ? partner : currentUsername,
                    text: m.text, time: m.time
                }));
            }
        } catch (e) { console.warn('Failed to load history:', e); }
    }

    async function saveMessageToDB(to, text) {
        try {
            await fetch('/api/chat/send', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin', body: JSON.stringify({ to, message: text })
            });
        } catch (_) {}
    }

    //  Unified search bar 
    // 1. Filters existing contact rows instantly (client-side)
    // 2. Queries /api/users/search for new users (debounced, server-side)
    // The debounce means we wait 300ms after the user stops typing before hitting
    // the server, so we're not firing a request on every single keystroke.

    async function handleSearchInput(query) {
        const term = query.toLowerCase();
        document.querySelectorAll('.contact-item').forEach(item => {
            const name = item.querySelector('.contact-name').textContent.toLowerCase();
            item.style.display = name.includes(term) ? 'flex' : 'none';
        });

        if (query.length < 1) {
            if (userSearchResults) { userSearchResults.style.display = 'none'; userSearchResults.innerHTML = ''; }
            return;
        }
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => searchUsersDB(query), 300);
    }

    async function searchUsersDB(query) {
        if (!isLoggedIn || !userSearchResults) return;
        try {
            const res  = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, { credentials: 'same-origin' });
            const data = await res.json();

            // Only show users NOT already displayed as contacts
            const existingNames = new Set(
                [...document.querySelectorAll('.contact-item')].map(el => el.dataset.username)
            );
            const newUsers = (data.users || []).filter(u => !existingNames.has(u.username));

            if (newUsers.length === 0) {
                userSearchResults.style.display = 'none';
                userSearchResults.innerHTML = '';
                return;
            }
            userSearchResults.innerHTML = '';
            newUsers.forEach(u => {
                const item       = document.createElement('div');
                item.className   = 'search-result-item';
                item.innerHTML   = `<div class="search-result-avatar">${u.username.charAt(0).toUpperCase()}</div><span>${escapeHtml(u.username)}</span>`;
                item.addEventListener('click', () => {
                    userSearchResults.style.display = 'none';
                    userSearchResults.innerHTML     = '';
                    if (searchInput) searchInput.value = '';
                    document.querySelectorAll('.contact-item').forEach(el => el.style.display = 'flex');
                    openChatWith(u.username);
                });
                userSearchResults.appendChild(item);
            });
            userSearchResults.style.display = 'block';
        } catch (_) {}
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (searchInput && userSearchResults &&
            !searchInput.contains(e.target) && !userSearchResults.contains(e.target))
            userSearchResults.style.display = 'none';
    });

    //  Render contacts 

    function renderContacts() {
        contactsListDiv.innerHTML = '';
        const allNames   = new Set();
        const contactMap = {};

        dbContacts.forEach(c => {
            allNames.add(c.username);
            contactMap[c.username] = { lastMessage: c.last_message, lastTime: c.last_time, isOnline: false };
        });

        onlineUsers.forEach(u => {
            if (u === currentUsername) return;
            allNames.add(u);
            if (contactMap[u]) contactMap[u].isOnline = true;
            else contactMap[u] = { lastMessage: '', lastTime: '', isOnline: true };
        });

        // If not logged in, show a clear prompt and redirect to the map login immediately
        if (!isLoggedIn) {
            contactsListDiv.innerHTML = `
                <div class="contact-placeholder">
                    <div style="font-size:28px;margin-bottom:10px;">🔒</div>
                    <strong style="color:#e9d5ff;font-size:13px;">You're not logged in</strong>
                    <p style="margin-top:6px;font-size:12px;line-height:1.6;color:#949ba4;">Redirecting you to the<br>login page…</p>
                </div>`;
            // Small delay so the user sees the message, then go to the map which shows login
            setTimeout(() => { window.location.href = '/map?login=1'; }, 1200);
            return;
        }

        if (allNames.size === 0) {
            contactsListDiv.innerHTML = '<div class="contact-placeholder">No chats yet search for a player above</div>';
            return;
        }

        [...allNames].forEach(username => {
            const info     = contactMap[username] || {};
            const isActive = currentChatPartner === username;

            let statusLabel;
            if (info.isOnline) statusLabel = '🟢 Online';
            else if (info.lastTime) statusLabel = `Last msg ${info.lastTime}`;
            else                    statusLabel = '⚫ Offline';

            const div             = document.createElement('div');
            div.className         = `contact-item ${isActive ? 'active' : ''}`;
            div.dataset.username  = username;
            div.innerHTML         = `
                <div class="contact-avatar">${username.charAt(0).toUpperCase()}</div>
                <div class="contact-info">
                    <div class="contact-name">${escapeHtml(username)}</div>
                    <div class="contact-status ${info.isOnline ? 'online' : ''}">${statusLabel}</div>
                </div>`;
            div.addEventListener('click', () => {
                document.querySelectorAll('.contact-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
                openChatWith(username);
            });
            contactsListDiv.appendChild(div);
        });
    }

    //  Open conversation 

    async function openChatWith(username) {
        currentChatPartner = username;
        chatNameSpan.textContent    = username;
        // Update avatar initial
        const avatarEl = document.getElementById('chatPartnerAvatar');
        if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase();
        removeTypingIndicator();
        document.querySelectorAll('.contact-item').forEach(el => {
            el.classList.toggle('active', el.dataset.username === username);
        });
        messagesDiv.innerHTML = '<div class="placeholder-message">Loading…</div>';
        await loadChatHistory(username);
        renderMessages(username);
        messageInput.disabled = false;
        sendBtn.disabled      = false;
        messageInput.focus();
        showConversationPanel(); // mobile: slide conversation into view
        if (isLoggedIn) await loadContactsFromDB(); // refresh so new chat appears in sidebar

        // Update the status shown under the partner name in the conversation header
        updatePartnerStatus(username);
    }

    //  Render messages 

    function renderMessages(partner) {
        removeTypingIndicator();
        messagesDiv.innerHTML = '';
        const history = messagesHistory[partner] || [];
        if (history.length === 0) {
            messagesDiv.innerHTML = '<div class="placeholder-message">No messages yet say hi!</div>';
            return;
        }
        history.forEach(msg => appendMessageBubble(msg));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function appendMessageBubble(msg) {
        const isSelf  = msg.from === currentUsername || msg.from === 'You';
        const div     = document.createElement('div');
        div.className = `message ${isSelf ? 'self' : ''}`;
        div.innerHTML = `
            <div class="sender">${escapeHtml(isSelf ? 'You' : msg.from)}</div>
            <div class="text">${escapeHtml(msg.text)}</div>
            <div class="time">${msg.time}</div>`;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addMessageLocally(from, to, text) {
        const partner = from === currentUsername ? to : from;
        if (!messagesHistory[partner]) messagesHistory[partner] = [];
        const msg = { from, to, text, time: getTime() };
        messagesHistory[partner].push(msg);
        if (currentChatPartner === partner) { removeTypingIndicator(); appendMessageBubble(msg); }
    }

    //  Typing indicator 
    // sends 'typing' / 'stop_typing' WebSocket events.

    function showTypingIndicator(fromUsername) {
        removeTypingIndicator();
        const div     = document.createElement('div');
        div.id        = 'typingIndicator';
        div.className = 'typing-indicator';
        div.innerHTML = `
            <span class="typing-dots"><span></span><span></span><span></span></span>
            <span class="typing-label">${escapeHtml(fromUsername)} is typing…</span>`;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function removeTypingIndicator() {
        document.getElementById('typingIndicator')?.remove();
    }

    function handleTyping() {
        if (!currentChatPartner || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;
        if (!isSendingTyping) {
            isSendingTyping = true;
            chatSocket.send(JSON.stringify({ to: currentChatPartner, type: 'typing' }));
        }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            isSendingTyping = false;
            if (chatSocket && chatSocket.readyState === WebSocket.OPEN)
                chatSocket.send(JSON.stringify({ to: currentChatPartner, type: 'stop_typing' }));
        }, 1500);
    }

    //  WebSocket 

    function connectWebSocket(username) {
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN) chatSocket.close();
        // Match the WS scheme to the page scheme so we don't get mixed-content blocks:
        // http pages use ws://, https pages use wss://.
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        chatSocket  = new WebSocket(`${proto}//${window.location.host}/ws/${username}`);

        chatSocket.onopen = () => {
            currentUsername        = username;
            statusSpan.textContent = `Connected as ${username}`;
            statusSpan.className   = 'status-online';
            onlineUsers.clear();
            renderContacts();
        };

        chatSocket.onmessage = (e) => {
            let data;
            try { data = JSON.parse(e.data); } catch { return; }
            if (data.system) { console.info('[WS]', data.system); return; }

            const from    = data.from;
            const msgType = data.type || 'message';

            if (msgType === 'typing')      { if (currentChatPartner === from) showTypingIndicator(from);  return; }
            if (msgType === 'stop_typing') { if (currentChatPartner === from) removeTypingIndicator();    return; }

            removeTypingIndicator();
            addMessageLocally(from, currentUsername, data.message);
            if (!onlineUsers.has(from)) { onlineUsers.add(from); loadContactsFromDB(); }
        };

        chatSocket.onclose = () => {
            statusSpan.textContent = isLoggedIn ? `Connected as ${currentUsername}` : 'Offline';
            statusSpan.className   = isLoggedIn ? 'status-online' : 'status-offline';
            onlineUsers.clear();
            renderContacts();
        };

        chatSocket.onerror = () => {
            statusSpan.textContent = 'Connection error';
            statusSpan.className   = 'status-offline';
        };
    }

    //  Send message 

    async function sendMessage() {
        if (!currentUsername)    { alert('Please log in first'); return; }
        if (!currentChatPartner) { alert('Select a contact first'); return; }

        const text = messageInput.value.trim();
        if (!text) return;
        messageInput.value = '';

        // Stop typing indicator
        clearTimeout(typingTimer);
        isSendingTyping = false;
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN)
            chatSocket.send(JSON.stringify({ to: currentChatPartner, type: 'stop_typing' }));


        await saveMessageToDB(currentChatPartner, text);
        addMessageLocally(currentUsername, currentChatPartner, text);
        if (chatSocket && chatSocket.readyState === WebSocket.OPEN)
            chatSocket.send(JSON.stringify({ to: currentChatPartner, type: 'message', message: text }));
    }

    //  Partner status in conversation header 
    // Shows online status or last-seen time under the partner's name.

    function updatePartnerStatus(username) {
        const statusEl = document.getElementById('chatPartnerStatus');
        if (!statusEl) return;
        if (onlineUsers.has(username)) {
            statusEl.textContent = '🟢 Online';
            statusEl.style.color = '#39d98a';
        } else {
            const contact = dbContacts.find(c => c.username === username);
            statusEl.textContent = contact?.last_time ? `Last seen ${contact.last_time}` : 'Offline';
            statusEl.style.color = '#6c6f78';
        }
    }

    //  Event listeners 

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !messageInput.disabled) sendMessage(); });
    messageInput.addEventListener('keydown', (e) => { if (e.key !== 'Enter') handleTyping(); });

    if (searchInput) {        searchInput.addEventListener('input', (e) => handleSearchInput(e.target.value.trim()));
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                handleSearchInput('');
                if (userSearchResults) userSearchResults.style.display = 'none';
            }
        });
    }

    //  Boot 
    checkLoginState().then(() => renderContacts());
}



// ══════════════════════════════════════════════════════════
//  LANDING  (Three.js globe)
//  NOTE: The animated rotating Earth globe effect on scroll
//  is AI-generated procedural code using Three.js.
//  Terrain, cloud, and specular map textures are built at
//  runtime via fractional Brownian motion (fBm) noise on
//  an HTML5 Canvas, then applied to a SphereGeometry mesh.
// ══════════════════════════════════════════════════════════

function initLanding() {
    const canvas = document.getElementById('globe-canvas');
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 0, 2.8);

    const globeGroup = new THREE.Group();
    globeGroup.position.x = 0.35;
    scene.add(globeGroup);

    // fBm noise builds terrain, cloud, and specular textures procedurally
    // hash() converts a 2D coordinate into a pseudo-random [0,1] float using a
    // classic sine-based hash. noise() smoothly interpolates between four surrounding
    // hash values using Hermite smoothstep (3t²-2t³), giving continuous gradient noise.
    // fbm() (fractional Brownian motion) stacks multiple octaves of noise at increasing
    // frequency and decreasing amplitude to produce natural-looking detail at every scale.
    function hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
    function noise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        // Smoothstep easing makes the interpolation curve C1-continuous (no sharp corners)
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        return (hash(ix, iy) * (1 - ux) + hash(ix + 1, iy) * ux) * (1 - uy) +
               (hash(ix, iy + 1) * (1 - ux) + hash(ix + 1, iy + 1) * ux) * uy;
    }
    function fbm(x, y, o) { let v = 0, a = 0.5; for (let i = 0; i < o; i++) { v += noise(x, y) * a; x *= 2; y *= 2; a *= 0.5; } return v; }
    function lerp(a, b, t) { return a + (b - a) * t; }

    function makeEarth() {
        const W = 1024, H = 512, c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
        for (let px = 0; px < W; px++) {
            for (let py = 0; py < H; py++) {
                const n = fbm((px / W) * 6.5, (py / H) * 4.0, 7);
                // pole is 0 at the equator and 1 at the poles used to blend in white ice caps
                const pole = Math.abs(((py / H) - 0.5) * Math.PI) / (Math.PI / 2);
                let r, g, b;
                // Each threshold maps an fBm value range to a terrain colour:
                // pole >0.78 → ice caps (lerp to white), n>0.62 → rocky mountains,
                // n>0.56 → dry land, n>0.52 → grass/jungle, else → ocean (deeper = darker)
                if (pole > 0.78)     { const t = Math.min((pole - 0.78) / 0.22, 1); r = lerp(40, 230, t); g = lerp(80, 240, t); b = lerp(150, 255, t); }
                else if (n > 0.62)   { r = 105 + n * 60; g = 82 + n * 40;  b = 60 + n * 30; }
                else if (n > 0.56)   { r = 90  + n * 40; g = 110 + n * 40; b = 50 + n * 20; }
                else if (n > 0.52)   { r = 30  + n * 20; g = 90  + n * 55; b = 35 + n * 20; }
                else                 { const dep = n / 0.52; r = 5 + dep * 20; g = 30 + dep * 65; b = 90 + dep * 80; }
                const i = (py * W + px) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return new THREE.CanvasTexture(c);
    }

    function makeClouds() {
        const W = 1024, H = 512, c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
        for (let px = 0; px < W; px++) {
            for (let py = 0; py < H; py++) {
                const n = fbm((px / W) * 4.0 + 12.7, (py / H) * 3.0 + 5.3, 6);
                // Only pixels above the 0.55 threshold are visible; below that the cloud layer
                // is fully transparent. The remap to [0..1] then scaled to 210 gives soft edges
                // instead of a hard on/off cutoff.
                const alpha = n > 0.55 ? Math.min((n - 0.55) / 0.25, 1) * 210 : 0;
                const i = (py * W + px) * 4; d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = alpha;
            }
        }
        ctx.putImageData(img, 0, 0);
        return new THREE.CanvasTexture(c);
    }

    function makeSpec() {
        const W = 512, H = 256, c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
        for (let px = 0; px < W; px++) {
            for (let py = 0; py < H; py++) {
                const v = fbm((px / W) * 6.5, (py / H) * 4.0, 4) < 0.52 ? 200 : 20;
                const i = (py * W + px) * 4; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return new THREE.CanvasTexture(c);
    }

    const earthMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 80, 80),
        new THREE.MeshPhongMaterial({ map: makeEarth(), specularMap: makeSpec(), specular: new THREE.Color(0x224488), shininess: 25 })
    );
    globeGroup.add(earthMesh);

    const cloudMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.012, 64, 64),
        new THREE.MeshPhongMaterial({ map: makeClouds(), transparent: true, opacity: 0.85, depthWrite: false })
    );
    globeGroup.add(cloudMesh);

    globeGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(1.025, 64, 64),
        new THREE.MeshPhongMaterial({ color: 0x3355cc, transparent: true, opacity: 0.07, side: THREE.FrontSide, depthWrite: false })
    ));

    const atmoMat = new THREE.MeshBasicMaterial({ color: 0x4466ee, transparent: true, opacity: 0.12, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.22, 64, 64), atmoMat));

    const rimMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.07, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    globeGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.45, 32, 32), rimMat));

    globeGroup.add(new THREE.Mesh(
        new THREE.SphereGeometry(1.006, 18, 18),
        new THREE.MeshBasicMaterial({ color: 0x9b59b6, wireframe: true, transparent: true, opacity: 0.04 })
    ));

    const dots = [];
    for (let i = 0; i < 16; i++) {
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.018, 8, 8),
            new THREE.MeshBasicMaterial({ color: [0x39d98a, 0xf5a623, 0xc084fc][i % 3] })
        );
        dot.userData = { theta: (i / 16) * Math.PI * 2, phi: (Math.random() * 0.65 + 0.18) * Math.PI, speed: 0.002 + Math.random() * 0.003, r: 1.10 };
        globeGroup.add(dot);
        dots.push(dot);
    }

    // Scatter 3500 stars randomly across a sphere. We sample theta (azimuth) uniformly
    // and phi (polar angle) via Math.acos(2*random-1) the acos ensures an even
    // distribution on the sphere surface instead of clustering near the poles.
    const sPos = new Float32Array(3500 * 3);
    for (let i = 0; i < 3500; i++) {
        const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 80 + Math.random() * 80;
        sPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        sPos[i * 3 + 1] = r * Math.cos(ph);
        sPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true })));

    scene.add(new THREE.AmbientLight(0x0a0a22, 0.7));
    const sun  = new THREE.DirectionalLight(0xfff4e0, 1.3); sun.position.set(5, 2, 4);   scene.add(sun);
    const fill = new THREE.DirectionalLight(0x112244, 0.4); fill.position.set(-5, -1, -4); scene.add(fill);
    const rim  = new THREE.PointLight(0x9b59b6, 1.2, 14);  rim.position.set(-4, 1, -3);  scene.add(rim);

    const heroTrigger  = document.getElementById('hero-trigger');
    const heroTextEl   = document.getElementById('heroText');
    const scrollHintEl = document.getElementById('scroll-hint');
    const enterBtnEl   = document.getElementById('enter-btn');
    let pct = 0;

    window.addEventListener('scroll', () => {
        const max = heroTrigger.offsetHeight - window.innerHeight;
        pct = Math.max(0, Math.min(window.scrollY / max, 1));

        earthMesh.rotation.y  = pct * Math.PI * 3;
        earthMesh.rotation.x  = Math.sin(pct * Math.PI) * 0.18;
        atmoMat.opacity       = 0.12 + pct * 0.20;
        rimMat.opacity        = 0.07 + pct * 0.14;
        rim.intensity         = 1.2  + pct * 3.0;
        camera.position.z     = 2.8  - pct * 0.3;

        heroTextEl.style.opacity   = pct < 0.15 ? 1 : Math.max(0, 1 - (pct - 0.15) / 0.15);
        scrollHintEl.style.opacity = pct < 0.04 ? 1 : 0;
        if (pct > 0.75) enterBtnEl.classList.add('show');
        else            enterBtnEl.classList.remove('show');
    });

    setTimeout(() => heroTextEl.classList.add('show'), 300);

    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();

    // Three.js uses Normalised Device Coordinates (NDC): x and y both in [-1, 1].
    // We convert raw pixel offsets to NDC here before passing to the raycaster.
    canvas.addEventListener('mousemove', (e) => {
        const r = canvas.getBoundingClientRect();
        mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
        mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        // If the ray hits the earth mesh we show a pointer cursor to hint it's clickable.
        canvas.style.cursor = raycaster.intersectObject(earthMesh).length ? 'pointer' : 'default';
    });

    canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
        mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.intersectObject(earthMesh).length) window.location.href = '/map';
    });

    // IntersectionObserver fires when an element enters the viewport.
    // threshold: 0.15 means at least 15% of the element must be visible before we add the class.
    document.querySelectorAll('[data-reveal]').forEach(el => {
        new IntersectionObserver((entries) => {
            entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('reveal'); });
        }, { threshold: 0.15 }).observe(el);
    });

    const STATS = { 'stat-online': 1284, 'stat-registered': 8741, 'stat-events': 312, 'stat-cities': 47 };

    function animateCount(el, target) {
        const start = performance.now();
        function tick(now) {
            // p goes from 0 to 1 over 1800ms.
            // (1 - (1-p)^3) is an "ease-out cubic" fast start, gentle landing.
            const p = Math.min((now - start) / 1800, 1);
            el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target).toLocaleString();
            if (p < 1) {
                requestAnimationFrame(tick);
            } else {
                el.textContent = target.toLocaleString();
                // After the count animation finishes, nudge the number ±2 every few
                // seconds to make the stats look live even though they're hardcoded.
                setInterval(() => {
                    const cur = parseInt(el.textContent.replace(/,/g, ''));
                    el.textContent = Math.max(0, cur + Math.floor(Math.random() * 5) - 2).toLocaleString();
                }, 3000 + Math.random() * 2000);
            }
        }
        requestAnimationFrame(tick);
    }

    const statsBar = document.getElementById('stats-bar');
    if (statsBar) {
        let fired = false;
        new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting && !fired) {
                    fired = true;
                    Object.entries(STATS).forEach(([id, target], i) => {
                        const el = document.getElementById(id);
                        if (el) setTimeout(() => animateCount(el, target), i * 150);
                    });
                }
            });
        }, { threshold: 0.3 }).observe(statsBar);
    }

    let t = 0;
    function animate() {
        requestAnimationFrame(animate);
        t += 0.005;
        if (pct < 0.02) earthMesh.rotation.y += 0.0008;
        cloudMesh.rotation.y = earthMesh.rotation.y * 1.08 + 0.12;
        cloudMesh.rotation.x = earthMesh.rotation.x * 0.6;
        dots.forEach(dot => {
            dot.userData.theta += dot.userData.speed;
            const { theta, phi, r } = dot.userData;
            dot.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
        });
        atmoMat.opacity = (0.12 + pct * 0.20) + Math.sin(t) * 0.015;
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}
// ══════════════════════════════════════════════════════════
//  SETTINGS
//  Paste this entire block at the bottom of app.js,
//  just ABOVE the existing "Boot" section, then add
//  initSettings() to the DOMContentLoaded call list.
// ══════════════════════════════════════════════════════════

function initSettings() {
    // Guard: only run on the settings page
    if (!document.querySelector('.gs-sidebar')) return;

    let settings = {}; // mirrors what's in the DB

    // ── Toast helper ─────────────────────────────────────────
    function showToast() {
        const t = document.getElementById('settings-toast');
        if (!t) return;
        t.style.opacity = '1';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.opacity = '0'; }, 1800);
    }

    // ── Load settings from DB on page open ───────────────────
    async function loadSettings() {
        try {
            const res  = await fetch('/api/settings', { credentials: 'same-origin' });
            const data = await res.json();
            if (!data.success) return;
            settings = data;
            applyToUI(data);
        } catch (e) { console.warn('Failed to load settings:', e); }
    }

    // ── Load profile info for Account section display ────────
    async function loadAccountDisplay() {
        try {
            const res  = await fetch('/api/me', { credentials: 'same-origin' });
            const data = await res.json();
            if (!data.logged_in) return;

            const username = data.username;

            // Username & avatar seed display
            const usernameEl = document.getElementById('display-username');
            const seedEl     = document.getElementById('display-avatar-seed');
            if (usernameEl) usernameEl.textContent = username;
            if (seedEl)     seedEl.textContent     = username;

            // Update navbar avatar to match logged-in user
            const avatarImg = document.querySelector('.avatar-img');
            if (avatarImg) {
                avatarImg.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
                avatarImg.alt = username;
            }

            // Load profile for Discord / Steam display
            const profRes  = await fetch('/api/profile', { credentials: 'same-origin' });
            const profData = await profRes.json();
            if (profData.success) {
                const discordEl = document.getElementById('display-discord');
                const steamEl   = document.getElementById('display-steam');
                const chipD     = document.getElementById('chip-discord');
                const chipS     = document.getElementById('chip-steam');

                if (discordEl && profData.discord) {
                    discordEl.textContent = profData.discord;
                    if (chipD) { chipD.textContent = 'Linked'; chipD.classList.add('green'); }
                }
                if (steamEl && profData.steam_username) {
                    steamEl.textContent = profData.steam_username;
                    if (chipS) { chipS.textContent = 'Linked'; chipS.classList.add('green'); }
                }
            }
        } catch (e) { console.warn('Failed to load account display:', e); }
    }

    // ── Push full state to DB ────────────────────────────────
    async function saveSettings() {
        try {
            const res = await fetch('/api/settings', {
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body:        JSON.stringify(settings),
            });
            const data = await res.json();
            if (data.success) showToast();
        } catch (e) { console.warn('Failed to save settings:', e); }
    }

    // ── Apply DB values → UI ─────────────────────────────────
    function applyToUI(s) {
        setToggle('toggle-map-visible',    s.map_visible);
        setToggle('toggle-show-status',    s.show_status);
        setToggle('toggle-public-profile', s.public_profile);
        setToggle('toggle-active-only',    s.active_only);
        setToggle('toggle-notif-messages', s.notif_messages);
        setToggle('toggle-notif-friends',  s.notif_friends);
        setToggle('toggle-notif-events',   s.notif_events);
        setToggle('toggle-notif-announce', s.notif_announce);
        setToggle('toggle-start-hero',     s.start_hero);

        const sel = document.getElementById('select-msg-permission');
        if (sel) sel.value = s.msg_permission || 'everyone';

        const slider = document.getElementById('rad');
        const label  = document.getElementById('radVal');
        if (slider) slider.value      = s.search_radius || 25;
        if (label)  label.textContent = `${s.search_radius || 25} km`;
    }

    function setToggle(id, on) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('on', !!on);
    }

    // ── Toggle ID → settings key map ────────────────────────
    const TOGGLE_MAP = {
        'toggle-map-visible':    'map_visible',
        'toggle-show-status':    'show_status',
        'toggle-public-profile': 'public_profile',
        'toggle-active-only':    'active_only',
        'toggle-notif-messages': 'notif_messages',
        'toggle-notif-friends':  'notif_friends',
        'toggle-notif-events':   'notif_events',
        'toggle-notif-announce': 'notif_announce',
        'toggle-start-hero':     'start_hero',
    };

    // ── Toggle click handler ─────────────────────────────────
    function handleToggleClick(e) {
        const toggle = e.target.closest('.gs-toggle');
        if (!toggle || !toggle.id) return;

        const isOn = toggle.classList.toggle('on');
        const key  = TOGGLE_MAP[toggle.id];
        if (!key) return;

        settings[key] = isOn;
        saveSettings();

        // Real-time side effects
        if (key === 'map_visible' && window.parent?.setDemoVisible) {
            window.parent.setDemoVisible(isOn);
        }
    }

    // ── Select change handler ────────────────────────────────
    function handleSelectChange(e) {
        if (e.target.id === 'select-msg-permission') {
            settings.msg_permission = e.target.value;
            saveSettings();
        }
    }

    // ── Slider: live label update, save on release ───────────
    function wireSlider() {
        const slider = document.getElementById('rad');
        const label  = document.getElementById('radVal');
        if (!slider) return;
        slider.addEventListener('input', () => {
            if (label) label.textContent = `${slider.value} km`;
            settings.search_radius = parseInt(slider.value, 10);
        });
        // Save only when the user releases to avoid hammering the DB
        slider.addEventListener('change', () => {
            settings.search_radius = parseInt(slider.value, 10);
            saveSettings();
        });
    }

    // ── Sidebar nav: highlight + smooth scroll ───────────────
    function wireSidebarNav() {
        document.querySelectorAll('.gs-nav-item[data-section]').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.gs-nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const target = document.getElementById(item.dataset.section);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    // ── Back button ──────────────────────────────────────────
    document.getElementById('settingsBackBtn')?.addEventListener('click', () => {
        if (window.parent?.closeModalPage) window.parent.closeModalPage();
        else history.back();
    });

    // ── Delete account (placeholder) ────────────────────────
    document.getElementById('deleteAccountBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete your account? This cannot be undone.')) {
            // TODO: call DELETE /api/account when that endpoint exists
            alert('Account deletion not yet implemented.');
        }
    });

    // ── Boot ─────────────────────────────────────────────────
    document.addEventListener('click',  handleToggleClick);
    document.addEventListener('change', handleSelectChange);
    wireSidebarNav();
    wireSlider();
    loadSettings();
    loadAccountDisplay();
}


// ══════════════════════════════════════════════════════════
//  Boot  (REPLACE the existing Boot block at the bottom of
//  app.js with this one — only change is initSettings() added)
// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initRegister();
    initProfile();      // includes initVisibilityToggle()
    initSteamSearch();  // Steam game search modal
    initChat();         // full chat with auto-connect, typing, mobile panels
    initLanding();      // Three.js globe scroll effect
    initSettings();     // ← NEW
});

//  Boot 
document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initRegister();
    initProfile();      // includes initVisibilityToggle()
    initSteamSearch();  // Steam game search modal
    initChat();         // full chat with auto-connect, typing, mobile panels
    initLanding();      // Three.js globe (AI-generated scroll effect)
    initSettings();     // user settings page with DB sync
});