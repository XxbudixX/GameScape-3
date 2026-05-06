# GameScape

GameScape is a web app that lets gamers find other players near them on an interactive map. You can see who is online, filter by game or age, click a player to view their profile, and send them a direct message.

---

## What it does

- Shows a live map with player markers color-coded by online status (active, recently active, offline)
- Filter players by game, age range, or location
- Click a marker to see a player's profile card (gamertag, rank, games, age)
- Register and log in with a username/email and password
- Edit your own profile (about me, games you play, interests)
- Chat with other players — messages are saved to the database and load on your next visit
- WebSocket support for real-time message delivery when both users are online

---

## Project structure

```
/
├── app.py              Flask backend — all API routes
├── databas.py          Database connection helper
│
├── index.html          Main page — map, navbar, hamburger menu, filter
├── layout.css          Global styles (navbar, modal overlay, sidebar, filter)
├── map.css             MapLibre popup and control styles
├── map.js              Map rendering, player markers, modals, menu, filters
├── sidebar.css         Hamburger menu panel styles
│
├── login/
│   ├── login.html      Login modal page (runs inside an iframe)
│   ├── login.css
│   └── login.js        Submits login form, communicates result to parent window
│
├── register/
│   ├── register.html   Registration modal page (runs inside an iframe)
│   ├── register.css
│   └── register.js     Submits register form, communicates result to parent window
│
├── profile/
│   ├── profile.html    Profile modal page (runs inside an iframe)
│   ├── profile.css
│   └── profile.js      Loads and saves profile data, toggles edit mode
│
└── chat/
    ├── chat.html       Full-screen chat page
    ├── chat.css
    └── chat.js         Contacts list, message history, WebSocket, DB save
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask |
| Database | PostgreSQL on Supabase |
| Map | MapLibre GL JS with a MapTiler style |
| Avatars | DiceBear API (generated from username) |
| Real-time chat | WebSocket (planned — routes not yet in app.py) |
| Password hashing | Werkzeug pbkdf2:sha256 |
| Fonts | Orbitron (headings), Quicksand (body) |

---

## Setup

**1. Install dependencies**

```bash
pip install flask psycopg2-binary werkzeug
```

**2. Configure the database**

Edit `config.ini` with your PostgreSQL credentials:

```ini
[database]
host = aws-1-eu-central-1.pooler.supabase.com
user = postgres.cnzwpafncqrlxvvducnb
port = 6543
password = hej_allainvonar3
database = postgres
```

**3. Create the database tables**

You need at minimum these two tables:

```sql
CREATE TABLE users (
    user_id   SERIAL PRIMARY KEY,
    username  TEXT UNIQUE NOT NULL,
    email     TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    full_name TEXT,
    birthday  DATE,
    gender    TEXT,
    status    TEXT DEFAULT 'offline',
    latitude  NUMERIC,
    longitude NUMERIC,
    last_active TIMESTAMP
);

CREATE TABLE messages (
    message_id  SERIAL PRIMARY KEY,
    sender_id   INT REFERENCES users(user_id),
    receiver_id INT REFERENCES users(user_id),
    message     TEXT NOT NULL,
    sent_at     TIMESTAMP DEFAULT NOW()
);
```

**4. Run the app**

```bash
python app.py
```

Then open `http://localhost:5000` in your browser.

---

## What's not done yet

**Profile saving** — The `/api/profile` GET and POST routes exist in `app.py` but are commented out. They need the `about_me`, `games`, and `interests` columns added to the `users` table before they can be uncommented:

```sql
ALTER TABLE users ADD COLUMN about_me TEXT;
ALTER TABLE users ADD COLUMN games TEXT;
ALTER TABLE users ADD COLUMN interests TEXT;
```

**WebSocket server** — `chat.js` tries to connect to `/ws/<username>` for real-time messaging. That WebSocket route doesn't exist in `app.py` yet. Messages still save and load from the database, but the real-time delivery won't work until a WebSocket handler is added (e.g. using `flask-sock` or `gevent-websocket`).

**Map players from database** — The map currently uses hardcoded player data from the `PLAYERS` array in `map.js`. The `/api/players` route exists and returns real players from the database, but `map.js` doesn't call it yet. Swap out the hardcoded array for a fetch call to wire this up.

**Chat button on player cards** — The "Start Chat" button on the player profile modal shows an alert placeholder. It should navigate to `chat/chat.html` and open a conversation with that player.

**Notifications and Settings** — Both menu items are placeholders that show an alert.

---

## Login and session notes

- Sessions are stored server-side using Flask's built-in session (cookie-based).
- The `secret_key` in `app.py` should be changed to something random before deploying. The current value `"hemlig_nyckel"` is not secure.
- Login accepts either username or email so users don't need to remember which one they registered with.
- After registering, the user is automatically logged in — no second login step needed.
- The login and register pages run inside iframes so they can have their own CSS without affecting the main page. They communicate back to the parent via `window.parent.setLoggedIn()` and `window.parent.closeModalPage()`.

---

## Password requirements

- 10 to 20 characters
- At least one uppercase letter
- At least one digit

These are enforced on the server side in `app.py` so they can't be bypassed by disabling JavaScript.
