// Tracks whether the user is currently in edit mode or view mode.
let editMode     = false;

// Holds the current profile data in memory so toggling edit mode can pre-fill the inputs
// without re-fetching from the server every time.
let profileData  = { about_me: '', games: '', interests: '' };

// Tracks whether the profile DB columns exist yet. The /api/profile endpoint is commented out
// in app.py until the SQL migration runs. This flag prevents the save button from trying to
// call an endpoint that doesn't exist yet.
let dbColumnsExist = false;

// Reusable SVG icons for games and interests in view mode.
// Defined as strings here so they can be injected into innerHTML without importing files.
const ICON_SVG     = `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:#c084fc;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M6 12h4m-2-2v4"/><circle cx="17" cy="11" r="1"/><circle cx="15" cy="13" r="1"/><path d="M3 8h18l-2 10H5L3 8z"/></svg>`;
const INTEREST_SVG = `<svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:none;stroke:#c084fc;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;


// Loads the profile page. First checks if the user is logged in via /api/me.
// If they are, it sets their username and avatar, then tries to load extended profile data
// from /api/profile. That second call will fail silently if the DB columns don't exist yet —
// the page just shows empty placeholder text instead of crashing.
// No input. Updates the DOM and global state as side effects.
async function loadProfile() {
    try {
        const meRes  = await fetch('/api/me', { credentials: 'same-origin' });
        const meData = await meRes.json();

        if (!meData.logged_in) {
            document.getElementById('profileName').textContent = 'Not logged in';
            return;
        }

        document.getElementById('profileName').textContent = meData.username;
        document.getElementById('profileAvatar').src =
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(meData.username)}`;

        try {
            const profRes  = await fetch('/api/profile', { credentials: 'same-origin' });
            const profData = await profRes.json();
            if (profData.success) {
                dbColumnsExist = true;
                profileData    = profData;
                renderView();
            }
        } catch (_) {
            // DB columns not added yet — silently skip, show empty state
        }

    } catch (e) {
        document.getElementById('profileName').textContent = 'Could not load profile';
    }
}


// Escapes HTML in user-supplied strings before putting them into innerHTML.
// Prevents a user's saved profile text from being interpreted as HTML tags.
// Input: str (string). Returns a safe string.
function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}


// Renders the profile data into the view-mode elements (the ones visible when not editing).
// Games and interests are stored as comma-separated strings, so they're split and turned into
// individual icon+label figures. Empty fields show placeholder text instead.
// No input. Reads from profileData global. Updates the DOM.
function renderView() {
    const aboutEl = document.getElementById('aboutView');
    if (profileData.about_me) {
        aboutEl.textContent = profileData.about_me;
        aboutEl.className   = 'about-text';
    } else {
        aboutEl.textContent = 'No description yet';
        aboutEl.className   = 'about-text empty-hint';
    }

    const gamesEl = document.getElementById('gamesView');
    const games   = profileData.games
        ? profileData.games.split(',').map(g => g.trim()).filter(Boolean)
        : [];
    if (games.length === 0) {
        gamesEl.innerHTML = '<span class="empty-hint">No games added yet</span>';
    } else {
        gamesEl.innerHTML = games.map((g, i) => `
            <figure ${i > 0 ? 'class="border-left"' : ''}>
                <div class="game-icon">${ICON_SVG}</div>
                <figcaption>${escapeHtml(g)}</figcaption>
            </figure>`).join('');
    }

    const intEl     = document.getElementById('interestsView');
    const interests = profileData.interests
        ? profileData.interests.split(',').map(i => i.trim()).filter(Boolean)
        : [];
    if (interests.length === 0) {
        intEl.innerHTML = '<span class="empty-hint">No interests added yet</span>';
    } else {
        intEl.innerHTML = interests.map((item, i) => `
            <figure ${i > 0 ? 'class="border-left"' : ''}>
                <div class="interest-icon">${INTEREST_SVG}</div>
                <figcaption>${escapeHtml(item)}</figcaption>
            </figure>`).join('');
    }
}


// Toggles between view mode and edit mode. In edit mode, the read-only display elements are
// hidden and replaced with text inputs pre-filled with the current values.
// The Save button and the edit icon's highlight state are also toggled.
// No input. Flips editMode global and updates the DOM.
function toggleEdit() {
    editMode = !editMode;

    document.getElementById('aboutView').style.display    = editMode ? 'none' : '';
    document.getElementById('aboutEdit').style.display    = editMode ? 'block' : 'none';
    if (editMode) document.getElementById('aboutEdit').value = profileData.about_me || '';

    document.getElementById('gamesView').style.display    = editMode ? 'none' : '';
    document.getElementById('gamesEdit').style.display    = editMode ? 'block' : 'none';
    if (editMode) document.getElementById('gamesInput').value = profileData.games || '';

    document.getElementById('interestsView').style.display = editMode ? 'none' : '';
    document.getElementById('interestsEdit').style.display  = editMode ? 'block' : 'none';
    if (editMode) document.getElementById('interestsInput').value = profileData.interests || '';

    document.getElementById('saveBtn').style.display = editMode ? 'block' : 'none';
    document.getElementById('editBtn').style.background =
        editMode ? 'rgba(155, 89, 182, 0.3)' : 'rgba(30, 31, 34, 0.6)';
}


// Sends the edited profile data to the Flask API and updates the local state on success.
// If dbColumnsExist is false, the endpoint doesn't exist yet, so we show a friendly message
// instead of a confusing 404 error.
// No input. Reads from the edit input fields. Updates profileData and switches back to view mode on success.
async function saveProfile() {
    if (!dbColumnsExist) {
        alert('Profile saving will be available soon!');
        return;
    }
    const payload = {
        about_me:  document.getElementById('aboutEdit').value.trim(),
        games:     document.getElementById('gamesInput').value.trim(),
        interests: document.getElementById('interestsInput').value.trim()
    };
    try {
        const res  = await fetch('/api/profile', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            // Update local cache so view mode shows the new values without re-fetching.
            profileData.about_me  = payload.about_me;
            profileData.games     = payload.games;
            profileData.interests = payload.interests;
            renderView();
            toggleEdit();
        } else {
            alert('Could not save: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error — could not save profile');
    }
}

// ── Map visibility toggle ─────────────────────────────────────
// The eye icon in profile.html toggles whether the logged-in user
// appears on the map. State is stored in localStorage and communicated
// to the parent map page via window.parent.setDemoVisible().
const VISIBLE_KEY = 'gamescape_demo_visible';

function getVisible() {
    const v = localStorage.getItem(VISIBLE_KEY);
    return v === null ? true : v === 'true';
}

function applyVisibilityUI(visible) {
    const eyeBtn = document.getElementById('visibilityBtn');
    if (!eyeBtn) return;
    eyeBtn.title = visible ? 'Hide me from map' : 'Show me on map';
    eyeBtn.style.background     = visible ? 'rgba(57,217,138,0.2)'  : 'rgba(30,31,34,0.6)';
    eyeBtn.style.borderColor    = visible ? 'rgba(57,217,138,0.7)'  : 'rgba(155,89,182,0.3)';
    // Replace eye SVG path to show open or closed eye
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
        // Tell the parent map page to update
        if (window.parent && window.parent.setDemoVisible) {
            window.parent.setDemoVisible(visible);
        }
    });
}

// Start loading the profile as soon as the script runs.
loadProfile().then(() => initVisibilityToggle()).catch(() => initVisibilityToggle());
// Fallback: also init after a short delay in case loadProfile doesn't return a promise
setTimeout(initVisibilityToggle, 300);