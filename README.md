# GameScape 

> Find gamers near you on an interactive map — connect, chat, and organise gaming sessions in real time.

---

## What it is

GameScape is a full-stack web app where gamers can see each other on a live map, send direct messages, and pin gaming events so nearby players can join them. It's built with Flask on the backend and plain HTML/CSS/JS on the frontend — no React, no bundler, just files.

---

## Features

- **Interactive map** — players show up as avatar markers with live status dots (active / recently active / offline)
- **Real-time chat** — WebSocket-powered DMs with typing indicators and a contact list that updates as people come online
- **Gaming events** — pin a session on the map with a custom time picker; other players see a pulsing ring and can click for details
- **Steam integration** — search Steam's store and add games to your profile; icons and metadata are cached in the DB
- **Player profiles** — about me, interests, Discord handle, Steam username, and a game showcase
- **Map filters** — filter visible players by game, age range, and city
- **Admin panel** — shown only to admin accounts; lets admins delete events and add games
- **Visibility toggle** — users can hide themselves from the map without logging out

---

# Tech stack

| Layer | What's used |
|---|---|
| Backend | Python 3, Flask, flask-sock (WebSockets) |
| Database | PostgreSQL on Supabase |
| DB driver | psycopg2 |
| Auth | Werkzeug password hashing (pbkdf2:sha256) |
| Map | MapLibre GL JS + MapTiler |
| 3D landing | Three.js (procedural globe with fBm noise textures) |
| Avatars | DiceBear Avataaars API |
| Fonts | Orbitron, Quicksand (Google Fonts) |

---

# Project structure

```
gamescape/
├── main.py          # Flask app — all API routes and WebSocket handler
├── databas.py       # DB connection helper (reads config.ini)
├── config.ini       # ← NOT in git (see below)
│
├── templates/       # HTML pages served by Flask
│   ├── landing.html
│   ├── index.html   # Map page
│   ├── chat.html
│   ├── login.html
│   ├── register.html
│   └── profile.html
│
└── static/
    ├── css/
    │   └── main.css
    └── js/
        ├── app.js   # Login, register, profile, chat, landing globe logic
        └── map.js   # Map markers, events, filters, admin panel
```

---

# Getting started

# 1. Clone the repo

```bash
git clone https://github.com/your-username/gamescape.git
cd gamescape
```

# 2. Install dependencies

```bash
pip install flask flask-sock psycopg2-binary werkzeug
```

# 3. Create `config.ini`

This file is gitignored because it contains your database credentials. Create it manually in the project root:

```ini
[database]
host     = your-db-host
user     = your-db-user
port     = 5432
password = your-password
database = your-db-name
```

> If you're using Supabase, grab the connection string from your project's **Settings → Database** page. Use the **connection pooler** host and port 6543 for best results.

# 4. Set up the database

The app expects these tables in the `public` schema:

```sql
-- Users
CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    full_name     TEXT,
    birthday      DATE,
    gender        TEXT,
    status        TEXT DEFAULT 'offline',
    latitude      FLOAT,
    longitude     FLOAT,
    last_active   TIMESTAMP,
    is_admin      BOOLEAN DEFAULT FALSE,
    is_banned     BOOLEAN DEFAULT FALSE,
    about_me      TEXT,
    interests     TEXT,
    discord       TEXT,
    steam_username TEXT
);

-- Messages
CREATE TABLE messages (
    id          SERIAL PRIMARY KEY,
    sender_id   INT REFERENCES users(user_id),
    receiver_id INT REFERENCES users(user_id),
    message     TEXT NOT NULL,
    sent_at     TIMESTAMP DEFAULT NOW()
);

-- Steam games cache
CREATE TABLE steam_games (
    appid      INT PRIMARY KEY,
    name       TEXT,
    icon_url   TEXT,
    header_url TEXT
);

-- User ↔ game link table
CREATE TABLE user_steam_games (
    user_id  INT REFERENCES users(user_id),
    appid    INT REFERENCES steam_games(appid),
    added_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, appid)
);

-- Events
CREATE TABLE events (
    id    SERIAL PRIMARY KEY,
    title TEXT
);

-- Games (admin-managed list)
CREATE TABLE games (
    id         SERIAL PRIMARY KEY,
    name       TEXT,
    image_name TEXT
);
```

# 5. Run the app

```bash
python main.py
```

Then open `http://localhost:5000` in your browser.

---

# Environment notes

- **`config.ini` is gitignored** — never commit it. Each environment (local, staging, prod) keeps its own copy.
- The app uses Flask's built-in session (cookie-based). Change `app.secret_key` in `main.py` to something long and random before deploying.
- WebSockets use `ws://` on HTTP and `wss://` on HTTPS automatically — no config needed.
- The map markers and player data on the map page are currently demo data hardcoded in `map.js`. Real player locations come from the `/api/players` endpoint once users set their coordinates.

---

# API overview

| Method | Route | Description |
|---|---|---|
| GET | `/api/me` | Current session info |
| POST | `/api/login` | Log in |
| POST | `/api/register` | Register |
| POST | `/api/logout` | Log out |
| GET | `/api/players` | All visible players with their games |
| GET/POST | `/api/profile` | Get / save profile fields |
| GET | `/api/steam/search?q=` | Search Steam store |
| POST | `/api/steam/game/<appid>` | Add a game to profile |
| DELETE | `/api/user/games/<appid>` | Remove a game from profile |
| GET | `/api/user/games` | Current user's saved games |
| GET | `/api/chat/contacts` | Conversations list |
| GET | `/api/chat/history/<username>` | Message history with a user |
| POST | `/api/chat/send` | Send a message |
| GET | `/api/users/search?q=` | Search users by username |
| GET | `/api/events` | List all events (admin) |
| DELETE | `/api/admin/delete_event/<id>` | Delete an event (admin only) |
| POST | `/api/admin/ban_user/<id>` | Ban a user (admin only) |
| WS | `/ws/<username>` | WebSocket connection for real-time chat |

---

# .gitignore

Make sure your `.gitignore` includes at least:

```
config.ini
__pycache__/
*.pyc
.env
```