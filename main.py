from gevent import monkey
monkey.patch_all()

from flask import Flask, request, jsonify, session, send_from_directory
from databas import connect_db
from werkzeug.security import check_password_hash, generate_password_hash
import os
import urllib.request
import urllib.parse
import json
from datetime import datetime

# Install with: pip install flask-sock
# We import inside a try/except so the app still starts even if flask_sock
# isn't installed all WebSocket routes are wrapped in the same check below,
# so the rest of the API keeps working without it.
try:
    from flask_sock import Sock
    SOCK_AVAILABLE = True
except ImportError:
    SOCK_AVAILABLE = False
    print("WARNING: flask_sock not installed. Run: pip install flask-sock")
print("SOCK_AVAILABLE =", SOCK_AVAILABLE)

ROOT = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)
app.secret_key = "hemlig_nyckel"

#  WebSocket connection registry 
# Maps username → active WebSocket object so messages can be routed by name.
if SOCK_AVAILABLE:
    sock = Sock(app)
connected_users = {}
connected_map_clients = set()

STEAM_API_KEY = 'FB52EAE94BCEB7061B36A1B69772CB2E'

#  Page routes 

@app.route('/')
def home():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'landing.html')

@app.route('/map')
def map_page():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'index.html')

@app.route('/chat')
def chat_page():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'chat.html')

@app.route('/login')
def login_page():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'login.html')

@app.route('/register')
def register_page():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'register.html')

@app.route('/profile')
def profile_page():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'profile.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(os.path.join(ROOT, 'static'), filename)
    
@app.route('/settings')
def settings_page():
    return send_from_directory(os.path.join(ROOT, 'templates'), 'settings.html')


#  Auth 

@app.route('/api/me', methods=['GET'])
def me():
    if 'user_id' in session:
        avatar_seed = session.get('avatar_seed') or session['username']
        # Refresh avatar_seed from the database on every session check so a page
        # reload never falls back to an older username-based DiceBear seed.
        conn, cur = connect_db()
        if conn is not None:
            try:
                cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed TEXT")
                conn.commit()
                cur.execute('SELECT avatar_seed FROM users WHERE user_id = %s', (session['user_id'],))
                row = cur.fetchone()
                if row and row[0]:
                    avatar_seed = row[0]
                    session['avatar_seed'] = avatar_seed
            except Exception as e:
                print(e)
            finally:
                cur.close(); conn.close()
        return jsonify({
            'logged_in':   True,
            'user_id':     session['user_id'],
            'username':    session['username'],
            'role':        session.get('role', False),
            'avatar_seed': avatar_seed
        })
    return jsonify({'logged_in': False, 'role': False})


@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data received'}), 400

    username_or_email = data.get('username_or_email', '').strip()
    password          = data.get('password', '')

    if not username_or_email or not password:
        return jsonify({'success': False, 'error': 'Missing username or password'}), 400

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database connection error'}), 500
    try:
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed TEXT")
        ensure_friend_requests_table(cur)
        ensure_presence_columns(cur)
        touch_current_user(cur)
        conn.commit()
        cur.execute(
            'SELECT user_id, username, password, is_admin, avatar_seed FROM users WHERE username = %s OR email = %s',
            (username_or_email, username_or_email)
        )
        user = cur.fetchone()
        if user is None:
            return jsonify({'success': False, 'error': 'User not found'}), 401
        if not check_password_hash(user[2], password):
            return jsonify({'success': False, 'error': 'Incorrect password'}), 401

        session['user_id']  = user[0]
        session['username'] = user[1]
        # is_admin comes back from Postgres as True/False/None we coerce it
        # explicitly to a Python bool so session.get('role') is always True or False,
        # never None, which avoids subtle bugs in the is_admin() check below.
        session['role']     = bool(user[3]) if user[3] is not None else False
        session['avatar_seed'] = user[4] or user[1]
        return jsonify({'success': True, 'username': user[1], 'avatar_seed': session['avatar_seed']})
    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': 'Login error'}), 500
    finally:
        cur.close(); conn.close()


def is_admin():
    return session.get('role') is True


@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data received'}), 400

    username   = data.get('username', '').strip()
    password   = data.get('password', '')
    confirm_pw = data.get('confirm_password', '')
    full_name  = data.get('full_name', '').strip()
    email      = data.get('email', '').strip()
    birthday   = data.get('birthday', '')
    gender     = data.get('gender', '')

    if not username or not password or not email or not full_name:
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    if password != confirm_pw:
        return jsonify({'success': False, 'error': 'Passwords do not match'}), 400
    if len(password) < 10:
        return jsonify({'success': False, 'error': 'Password must be at least 10 characters'}), 400
    if len(password) > 20:
        return jsonify({'success': False, 'error': 'Password must be at most 20 characters'}), 400
    if not any(c.isupper() for c in password):
        return jsonify({'success': False, 'error': 'Password must contain at least one uppercase letter'}), 400
    if not any(c.isdigit() for c in password):
        return jsonify({'success': False, 'error': 'Password must contain at least one digit'}), 400
    if not birthday:
        return jsonify({'success': False, 'error': 'Please select a birthday'}), 400
    if not gender:
        return jsonify({'success': False, 'error': 'Please select a gender'}), 400

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database connection error'}), 500
    try:
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed TEXT")
        ensure_friend_requests_table(cur)
        ensure_presence_columns(cur)
        touch_current_user(cur)
        conn.commit()
        cur.execute('SELECT user_id FROM users WHERE username = %s', (username,))
        if cur.fetchone():
            return jsonify({'success': False, 'error': 'Username already taken'}), 409
        cur.execute('SELECT user_id FROM users WHERE email = %s', (email,))
        if cur.fetchone():
            return jsonify({'success': False, 'error': 'Email already registered'}), 409

        hashed = generate_password_hash(password, method='pbkdf2:sha256')
        # RETURNING user_id gives us the new row's PK in the same round-trip
        # instead of running a second SELECT to find it.
        cur.execute(
            'INSERT INTO users (username, email, password, full_name, birthday, gender, avatar_seed) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING user_id',
            (username, email, hashed, full_name, birthday, gender, username)
        )
        new_user_id = cur.fetchone()[0]
        conn.commit()
        session['user_id']  = new_user_id
        session['username'] = username
        session['role']     = False
        session['avatar_seed'] = username
        return jsonify({'success': True, 'username': username, 'avatar_seed': session['avatar_seed']})
    except Exception as e:
        print(e)
        conn.rollback()
        return jsonify({'success': False, 'error': 'Registration error'}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})


#  Players 

@app.route('/api/players', methods=['GET'])
def get_players():
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        req_lat = None
        req_lng = None
        radius_km = 25

        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed TEXT")
        ensure_friend_requests_table(cur)
        ensure_presence_columns(cur)
        touch_current_user(cur)
        conn.commit()
        cur.execute("""
            SELECT user_id, username, status, latitude, longitude, last_active, avatar_seed,
                   COALESCE(is_invisible,FALSE) AS is_invisible,
                   CASE
                       WHEN COALESCE(is_invisible,FALSE) THEN 'offline'
                       WHEN last_active >= (CURRENT_TIMESTAMP - INTERVAL '30 seconds') THEN 'active'
                       WHEN last_active >= (CURRENT_TIMESTAMP - INTERVAL '10 minutes') THEN 'recent'
                       ELSE 'offline'
                   END AS live_status,
                   CASE
                       WHEN last_active >= (CURRENT_TIMESTAMP - INTERVAL '30 seconds') THEN 'Just now'
                       WHEN last_active >= (CURRENT_TIMESTAMP - INTERVAL '10 minutes') THEN 'Recently'
                       ELSE COALESCE(last_active::text, 'Unknown')
                   END AS last_active_label
            FROM users
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND COALESCE(is_invisible,FALSE) = FALSE
              AND COALESCE(status, 'offline') != 'invisible'
        """)
        rows = cur.fetchall()

        players = []
        for r in rows:
            uid      = r[0]
            plat     = float(r[3])
            plng     = float(r[4])

            # Radius filter — only apply if the requesting user has a location
            if req_lat is not None and req_lng is not None:
                # Haversine distance in km (pure SQL would be cleaner at scale,
                # but Python is fine for the current user count)
                import math
                dlat  = math.radians(plat - req_lat)
                dlng  = math.radians(plng - req_lng)
                a     = (math.sin(dlat / 2) ** 2
                         + math.cos(math.radians(req_lat))
                         * math.cos(math.radians(plat))
                         * math.sin(dlng / 2) ** 2)
                dist_km = 6371 * 2 * math.asin(math.sqrt(a))
                if dist_km > radius_km:
                    continue  # skip players outside the radius

            cur.execute("""
                SELECT sg.appid, sg.name, sg.icon_url
                FROM steam_games sg
                JOIN user_steam_games usg ON sg.appid = usg.appid
                WHERE usg.user_id = %s LIMIT 6
            """, (uid,))
            games = [{'appid': g[0], 'name': g[1], 'icon_url': g[2]} for g in cur.fetchall()]
            cur.execute("SELECT birthday FROM users WHERE user_id=%s", (uid,))
            meta = cur.fetchone() or (None,)
            is_self = bool('user_id' in session and uid == session['user_id'])
            last_active = r[5]
            live_status = r[8] or 'offline'
            players.append({
                'id':         uid,
                'gamertag':   r[1],
                'status':     live_status,
                'lat':        float(r[3]),
                'lng':        float(r[4]),
                'lastActive': r[9] or ('Just now' if live_status == 'active' else (str(last_active) if last_active else 'Unknown')),
                'avatarSeed': r[6] or r[1],
                'games':      games,
            })
            players[-1].update({
                'age': calculate_age(meta[0]) or '—',
                'friendship_status': friendship_status(cur, session['user_id'], uid) if 'user_id' in session and not is_self else 'self',
                'is_self': is_self,
            })
        return jsonify({'success': True, 'players': players})
    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()

#  Profile 
# Requires running steam_migration.sql first (adds about_me and interests columns).

@app.route('/api/profile', methods=['GET'])
def get_profile():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    try:
        # Ensure all profile columns exist
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS about_me       TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS interests      TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS discord        TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS steam_username TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed    TEXT")
        conn.commit()

        target_user = request.args.get('user')
        if target_user:
            cur.execute(
                'SELECT user_id, username, about_me, interests, discord, steam_username, avatar_seed FROM users WHERE username = %s',
                (target_user,)
            )
        else:
            cur.execute(
                'SELECT user_id, username, about_me, interests, discord, steam_username, avatar_seed FROM users WHERE user_id = %s',
                (session['user_id'],)
            )
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'User not found'}), 404

        row_user_id = row[0]

        # Respect public_profile setting when viewing another user
        viewing_other = target_user and target_user != session.get('username')
        if viewing_other:
            cur.execute("SELECT public_profile FROM users WHERE user_id = %s", (row_user_id,))
            priv = cur.fetchone()
            if priv and not priv[0]:
                return jsonify({'success': False, 'error': 'This profile is private'}), 403

        # Visibility (only relevant for own profile)
        cur.execute('SELECT COALESCE(is_invisible, FALSE) FROM users WHERE user_id = %s', (row_user_id,))
        visible_row = cur.fetchone()

        return jsonify({
            'success':        True,
            'username':       row[1],
            'about_me':       row[2] or '',
            'interests':      row[3] or '',
            'discord':        row[4] or '',
            'steam_username': row[5] or '',
            'avatar_seed':    row[6] or row[1],
            'visible':        not bool(visible_row[0]) if visible_row else True,
            'is_invisible':   bool(visible_row[0]) if visible_row else False,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()

@app.route('/api/profile', methods=['POST'])
def save_profile():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json()
    conn, cur = connect_db()
    try:
        # Auto-add columns safe with IF NOT EXISTS
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS about_me       TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS interests      TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS discord        TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS steam_username TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_seed TEXT")
        conn.commit()

        avatar_seed = (data.get('avatar_seed') or session.get('avatar_seed') or session.get('username') or 'GameScape')[:80]
        cur.execute(
            'UPDATE users SET about_me=%s, interests=%s, discord=%s, steam_username=%s, avatar_seed=%s WHERE user_id=%s',
            (
                data.get('about_me',       ''),
                data.get('interests',      ''),
                data.get('discord',        ''),
                data.get('steam_username', ''),
                avatar_seed,
                session['user_id']
            )
        )
        session['avatar_seed'] = avatar_seed
        conn.commit()
        return jsonify({'success': True, 'avatar_seed': avatar_seed})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()

@app.route('/create_event', methods=['POST'])
def create_event():
    if 'user_id' not in session:
        return jsonify({'error': 'Inte inloggad'}), 401
    try:
        data          = request.json
        title         = data.get('title')
        datetime_value = data.get('datetime')
        description   = data.get('description')
        min_rank      = data.get('min_rank')
        max_rank      = data.get('max_rank')
        appid         = data.get('appid')

        if not title or not appid or not datetime_value:
            return jsonify({'error': 'Missing required fields'}), 400

        conn, cur = connect_db()
        cur.execute("""
            INSERT INTO event (creator_id, appid, title, datetime, description, min_rank, max_rank)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (session['user_id'], appid, title, datetime_value, description, min_rank, max_rank))
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'message': 'Event skapat'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500    

#  Settings 
@app.route('/api/settings', methods=['GET'])
def get_settings():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    try:
        # Add columns safely — no-op if they already exist
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS map_visible    BOOLEAN DEFAULT true")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS show_status    BOOLEAN DEFAULT true")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS public_profile BOOLEAN DEFAULT true")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS msg_permission TEXT    DEFAULT 'everyone'")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS search_radius  INT     DEFAULT 25")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS active_only    BOOLEAN DEFAULT false")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_messages BOOLEAN DEFAULT true")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_friends  BOOLEAN DEFAULT true")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_events   BOOLEAN DEFAULT true")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_announce BOOLEAN DEFAULT true")
        conn.commit()

        cur.execute("""
            SELECT map_visible, show_status, public_profile, msg_permission,
                   search_radius, active_only,
                   notif_messages, notif_friends, notif_events, notif_announce
            FROM users WHERE user_id = %s
        """, (session['user_id'],))
        row = cur.fetchone()
        return jsonify({
            'success':        True,
            'map_visible':    row[0] if row[0] is not None else True,
            'show_status':    row[1] if row[1] is not None else True,
            'public_profile': row[2] if row[2] is not None else True,
            'msg_permission': row[3] or 'everyone',
            'search_radius':  row[4] if row[4] is not None else 25,
            'active_only':    row[5] if row[5] is not None else False,
            'notif_messages': row[6] if row[6] is not None else True,
            'notif_friends':  row[7] if row[7] is not None else True,
            'notif_events':   row[8] if row[8] is not None else True,
            'notif_announce': row[9] if row[9] is not None else True,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/settings', methods=['POST'])
def save_settings():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data'}), 400
    conn, cur = connect_db()
    try:
        cur.execute("""
            UPDATE users SET
                map_visible    = %s,
                show_status    = %s,
                public_profile = %s,
                msg_permission = %s,
                search_radius  = %s,
                active_only    = %s,
                notif_messages = %s,
                notif_friends  = %s,
                notif_events   = %s,
                notif_announce = %s
            WHERE user_id = %s
        """, (
            bool(data.get('map_visible',    True)),
            bool(data.get('show_status',    True)),
            bool(data.get('public_profile', True)),
            data.get('msg_permission', 'everyone'),
            int(data.get('search_radius',   25)),
            bool(data.get('active_only',    False)),
            bool(data.get('notif_messages', True)),
            bool(data.get('notif_friends',  True)),
            bool(data.get('notif_events',   True)),
            bool(data.get('notif_announce', True)),
            session['user_id']
        ))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close();
        conn.close()

#  Admin 

@app.route('/api/admin/delete_event/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    conn, cur = connect_db()
    try:
        cur.execute('DELETE FROM event WHERE event_id = %s', (event_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        cur.close(); conn.close()


@app.route('/api/admin/ban_user/<int:user_id>', methods=['POST'])
def ban_user(user_id):
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    conn, cur = connect_db()
    try:
        cur.execute('UPDATE users SET is_banned=true WHERE user_id=%s', (user_id,))
        conn.commit()
        return jsonify({'success': True})
    finally:
        cur.close(); conn.close()


# Add game to the global games table (admin only) 
@app.route('/api/admin/add_game', methods=['POST'])
def add_game():
    if not is_admin():
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    data  = request.get_json()
    name  = data.get('name')
    image = data.get('image_name')
    conn, cur = connect_db()
    try:
        cur.execute("INSERT INTO games (name, image_name) VALUES (%s, %s)", (name, image))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


#  Events list endpoint for admin panel 
@app.route('/api/events', methods=['GET'])
def get_events():
    conn, cur = connect_db()
    try:
        cur.execute("SELECT event_id, title FROM event")
        rows   = cur.fetchall()
        events = [{'id': r[0], 'title': r[1]} for r in rows]
        return jsonify({'events': events})
    except Exception as e:
        return jsonify({'events': [], 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


#  Steam 

def _steam_request(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'GameScape/1.0'})
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode())


@app.route('/api/steam/search', methods=['GET'])
def steam_search():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'success': False, 'error': 'No query'}), 400
    try:
        data    = _steam_request(
            f'https://store.steampowered.com/api/storesearch/?term={urllib.parse.quote(q)}&l=english&cc=US'
        )
        results = []
        for item in data.get('items', [])[:12]:
            appid = item.get('id')
            results.append({
                'appid':    appid,
                'name':     item.get('name', ''),
                'icon_url': f'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_sm_120.jpg',
            })
        return jsonify({'success': True, 'results': results})
    except Exception as e:
        print('Steam search error:', e)
        return jsonify({'success': False, 'error': 'Steam search failed'}), 500


@app.route('/api/steam/game/<int:appid>', methods=['POST'])
def save_steam_game(appid):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    body = request.get_json() or {}
    try:
        data      = _steam_request(f'https://store.steampowered.com/api/appdetails?appids={appid}&l=english')
        game_data = data.get(str(appid), {})
        if game_data.get('success'):
            info     = game_data['data']
            name     = info.get('name', body.get('name', f'App {appid}'))
            icon_url = f'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_sm_120.jpg'
            header   = info.get('header_image', icon_url)
        else:
            raise ValueError('Steam returned success=false')
    except Exception as e:
        print(f'Steam fallback for {appid}:', e)
        name     = body.get('name', f'App {appid}')
        icon_url = body.get('icon_url', f'https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/capsule_sm_120.jpg')
        header   = icon_url

    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'DB error'}), 500
    try:
        # ON CONFLICT (appid) DO UPDATE is an "upsert" if the game already exists in
        # steam_games we just refresh its metadata instead of failing with a duplicate-key error.
        cur.execute("""
            INSERT INTO steam_games (appid, name, icon_url, header_url)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (appid) DO UPDATE SET name=%s, icon_url=%s, header_url=%s
        """, (appid, name, icon_url, header, name, icon_url, header))
        # ON CONFLICT DO NOTHING skips silently if this user already has this game linked.
        cur.execute("""
            INSERT INTO user_steam_games (user_id, appid) VALUES (%s,%s)
            ON CONFLICT DO NOTHING
        """, (session['user_id'], appid))
        conn.commit()
        return jsonify({'success': True, 'game': {'appid': appid, 'name': name, 'icon_url': icon_url, 'header_url': header}})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/user/games', methods=['GET'])
def get_user_games():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    try:
        cur.execute("""
            SELECT sg.appid, sg.name, sg.icon_url, sg.header_url
            FROM steam_games sg
            JOIN user_steam_games usg ON sg.appid = usg.appid
            WHERE usg.user_id = %s ORDER BY usg.added_at DESC
        """, (session['user_id'],))
        games = [{'appid': r[0], 'name': r[1], 'icon_url': r[2], 'header_url': r[3]} for r in cur.fetchall()]
        return jsonify({'success': True, 'games': games})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/user/games/<int:appid>', methods=['DELETE'])
def remove_user_game(appid):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    try:
        cur.execute('DELETE FROM user_steam_games WHERE user_id=%s AND appid=%s', (session['user_id'], appid))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/steam/all_games', methods=['GET'])
def all_steam_games():
    conn, cur = connect_db()
    try:
        cur.execute('SELECT appid, name, icon_url FROM steam_games ORDER BY name ASC')
        games = [{'appid': r[0], 'name': r[1], 'icon_url': r[2]} for r in cur.fetchall()]
        return jsonify({'success': True, 'games': games})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()



#  Friends 

def ensure_friend_requests_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS friend_requests (
            id SERIAL PRIMARY KEY,
            requester_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            receiver_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK (requester_id != receiver_id),
            UNIQUE (requester_id, receiver_id)
        )
    """)


def ensure_presence_columns(cur):
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_invisible BOOLEAN DEFAULT FALSE")
    cur.execute("UPDATE users SET is_invisible=TRUE WHERE status='invisible'")
    cur.execute("UPDATE users SET status='offline' WHERE status IS NULL OR status IN ('active','invisible')")


def ensure_message_read_column(cur):
    cur.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP")


def touch_current_user(cur):
    if 'user_id' in session:
        ensure_presence_columns(cur)
        cur.execute("""
            UPDATE users
            SET is_online=CASE WHEN COALESCE(is_invisible,FALSE) THEN FALSE ELSE TRUE END,
                last_active=CURRENT_TIMESTAMP
            WHERE user_id=%s
        """, (session['user_id'],))


def get_user_id_by_username(cur, username):
    cur.execute('SELECT user_id, username FROM users WHERE username = %s', (username,))
    return cur.fetchone()


def friendship_status(cur, my_id, other_id):
    cur.execute("""
        SELECT requester_id, receiver_id, status
        FROM friend_requests
        WHERE (requester_id=%s AND receiver_id=%s) OR (requester_id=%s AND receiver_id=%s)
        LIMIT 1
    """, (my_id, other_id, other_id, my_id))
    row = cur.fetchone()
    if not row:
        return 'none'
    requester_id, receiver_id, status = row
    if status == 'accepted':
        return 'friends'
    if status == 'pending' and requester_id == my_id:
        return 'outgoing'
    if status == 'pending' and receiver_id == my_id:
        return 'incoming'
    return status or 'none'


def calculate_age(birthday):
    if not birthday:
        return None
    today = datetime.utcnow().date()
    return today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))


@app.route('/api/presence', methods=['POST'])
def update_presence():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json() or {}
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_presence_columns(cur)
        lat = data.get('lat')
        lng = data.get('lng')
        if lat is not None and lng is not None:
            cur.execute("""
                UPDATE users
                SET latitude=%s, longitude=%s,
                    is_online=CASE WHEN COALESCE(is_invisible,FALSE) THEN FALSE ELSE TRUE END,
                    last_active=CURRENT_TIMESTAMP
                WHERE user_id=%s
            """, (lat, lng, session['user_id']))
        else:
            touch_current_user(cur)
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/visibility', methods=['POST'])
def set_visibility():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json() or {}
    visible = bool(data.get('visible', True))
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_presence_columns(cur)
        cur.execute("""
            UPDATE users
            SET is_invisible=%s,
                is_online=CASE WHEN %s THEN FALSE ELSE TRUE END,
                last_active=CURRENT_TIMESTAMP
            WHERE user_id=%s
        """, (not visible, not visible, session['user_id']))
        conn.commit()
        return jsonify({'success': True, 'visible': visible})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/friends', methods=['GET'])
def friends_list():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_friend_requests_table(cur)
        ensure_message_read_column(cur)
        touch_current_user(cur)
        conn.commit()
        my_id = session['user_id']

        cur.execute("""
            SELECT u.username,
                   CASE WHEN u.last_active > CURRENT_TIMESTAMP - INTERVAL '30 seconds' AND COALESCE(u.is_invisible,FALSE)=FALSE THEN true ELSE false END AS online,
                   COALESCE(u.avatar_seed, u.username),
                   COALESCE(unread.count, 0) AS unread_count
            FROM friend_requests fr
            JOIN users u ON u.user_id = CASE WHEN fr.requester_id=%s THEN fr.receiver_id ELSE fr.requester_id END
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS count FROM messages
                WHERE sender_id = u.user_id AND receiver_id = %s AND read_at IS NULL
            ) unread ON true
            WHERE fr.status='accepted' AND (fr.requester_id=%s OR fr.receiver_id=%s)
            ORDER BY online DESC, u.username ASC
        """, (my_id, my_id, my_id, my_id))
        friends = [{'username': r[0], 'online': bool(r[1]), 'avatar_seed': r[2], 'unread_count': int(r[3] or 0)} for r in cur.fetchall()]

        cur.execute("""
            SELECT u.username
            FROM friend_requests fr
            JOIN users u ON u.user_id = fr.requester_id
            WHERE fr.receiver_id=%s AND fr.status='pending'
            ORDER BY fr.created_at DESC
        """, (my_id,))
        incoming = [{'username': r[0]} for r in cur.fetchall()]

        cur.execute("""
            SELECT u.username
            FROM friend_requests fr
            JOIN users u ON u.user_id = fr.receiver_id
            WHERE fr.requester_id=%s AND fr.status='pending'
            ORDER BY fr.created_at DESC
        """, (my_id,))
        outgoing = [{'username': r[0]} for r in cur.fetchall()]

        return jsonify({'success': True, 'friends': friends, 'incoming': incoming, 'outgoing': outgoing})
    except Exception as e:
        print(e)
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/friends/request', methods=['POST'])
def friend_request():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    if not username:
        return jsonify({'success': False, 'error': 'Missing username'}), 400
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_friend_requests_table(cur)
        my_id = session['user_id']
        other = get_user_id_by_username(cur, username)
        if not other:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        other_id = other[0]
        if other_id == my_id:
            return jsonify({'success': False, 'error': 'You cannot add yourself'}), 400

        cur.execute("""
            SELECT id, requester_id, receiver_id, status
            FROM friend_requests
            WHERE (requester_id=%s AND receiver_id=%s) OR (requester_id=%s AND receiver_id=%s)
            LIMIT 1
        """, (my_id, other_id, other_id, my_id))
        existing = cur.fetchone()
        if existing:
            req_id, requester_id, receiver_id, status = existing
            if status == 'accepted':
                return jsonify({'success': True, 'status': 'friends', 'message': 'Already friends'})
            if requester_id == other_id and receiver_id == my_id:
                cur.execute("UPDATE friend_requests SET status='accepted', updated_at=CURRENT_TIMESTAMP WHERE id=%s", (req_id,))
                conn.commit()
                return jsonify({'success': True, 'status': 'friends', 'message': 'Friend request accepted'})
            return jsonify({'success': True, 'status': 'outgoing', 'message': 'Friend request already sent'})

        cur.execute(
            "INSERT INTO friend_requests (requester_id, receiver_id, status) VALUES (%s,%s,'pending')",
            (my_id, other_id)
        )
        conn.commit()
        return jsonify({'success': True, 'status': 'outgoing', 'message': 'Friend request sent'})
    except Exception as e:
        print(e)
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/friends/accept', methods=['POST'])
def friend_accept():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_friend_requests_table(cur)
        other = get_user_id_by_username(cur, username)
        if not other:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        cur.execute("""
            UPDATE friend_requests
            SET status='accepted', updated_at=CURRENT_TIMESTAMP
            WHERE requester_id=%s AND receiver_id=%s AND status='pending'
        """, (other[0], session['user_id']))
        if cur.rowcount == 0:
            return jsonify({'success': False, 'error': 'No pending request found'}), 404
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/friends/decline', methods=['POST'])
@app.route('/api/friends/ignore', methods=['POST'])
def friend_decline():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_friend_requests_table(cur)
        other = get_user_id_by_username(cur, username)
        if not other:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        cur.execute("""
            DELETE FROM friend_requests
            WHERE requester_id=%s AND receiver_id=%s AND status='pending'
        """, (other[0], session['user_id']))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/friends/<username>', methods=['DELETE'])
def friend_remove(username):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        ensure_friend_requests_table(cur)
        other = get_user_id_by_username(cur, username)
        if not other:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        cur.execute("""
            DELETE FROM friend_requests
            WHERE status='accepted' AND ((requester_id=%s AND receiver_id=%s) OR (requester_id=%s AND receiver_id=%s))
        """, (session['user_id'], other[0], other[0], session['user_id']))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


#  Chat HTTP endpoints 

@app.route('/api/chat/contacts', methods=['GET'])
def chat_contacts():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        # JOIN LATERAL runs the inner subquery once per row of the outer table (users).
        # Here it fetches the single most-recent message between the current user and
        # each other user. A plain JOIN + GROUP BY can't do this cleanly because we need
        # the actual message text, not just an aggregated timestamp.
        cur.execute("""
            SELECT u.username, m.message, m.sent_at
            FROM users u
            JOIN LATERAL (
                SELECT message, sent_at FROM messages
                WHERE (sender_id = %s AND receiver_id = u.user_id)
                   OR (sender_id = u.user_id AND receiver_id = %s)
                ORDER BY sent_at DESC LIMIT 1
            ) m ON true
            WHERE u.user_id != %s
            ORDER BY m.sent_at DESC
        """, (session['user_id'], session['user_id'], session['user_id']))
        contacts = [
            {'username': r[0], 'last_message': r[1], 'last_time': r[2].strftime('%H:%M') if r[2] else ''}
            for r in cur.fetchall()
        ]
        ensure_friend_requests_table(cur)
        ensure_message_read_column(cur)
        touch_current_user(cur)
        conn.commit()
        my_id = session['user_id']
        contact_names = {c['username'] for c in contacts}
        cur.execute("""
            SELECT u.username,
                   CASE WHEN u.last_active > CURRENT_TIMESTAMP - INTERVAL '30 seconds' AND COALESCE(u.is_invisible,FALSE)=FALSE THEN true ELSE false END AS online,
                   COALESCE(u.avatar_seed, u.username),
                   COALESCE(unread.count, 0) AS unread_count
            FROM friend_requests fr
            JOIN users u ON u.user_id = CASE WHEN fr.requester_id=%s THEN fr.receiver_id ELSE fr.requester_id END
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS count FROM messages
                WHERE sender_id = u.user_id AND receiver_id = %s AND read_at IS NULL
            ) unread ON true
            WHERE fr.status='accepted' AND (fr.requester_id=%s OR fr.receiver_id=%s)
            ORDER BY online DESC, u.username ASC
        """, (my_id, my_id, my_id, my_id))
        for r in cur.fetchall():
            if r[0] in contact_names:
                for c in contacts:
                    if c['username'] == r[0]:
                        c.update({'is_friend': True, 'online': bool(r[1]), 'avatar_seed': r[2], 'unread_count': int(r[3] or 0)})
                        break
            else:
                contacts.append({'username': r[0], 'last_message': '', 'last_time': '', 'is_friend': True, 'online': bool(r[1]), 'avatar_seed': r[2], 'unread_count': int(r[3] or 0)})
        return jsonify({'success': True, 'contacts': contacts})
    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


@app.route('/api/chat/history/<partner_username>', methods=['GET'])
def chat_history(partner_username):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        cur.execute('SELECT user_id FROM users WHERE username = %s', (partner_username,))
        partner = cur.fetchone()
        if not partner:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        my_id = session['user_id']
        ensure_friend_requests_table(cur)
        ensure_message_read_column(cur)
        if friendship_status(cur, my_id, partner[0]) != 'friends':
            return jsonify({'success': False, 'error': 'You can only view chats with friends'}), 403
        cur.execute("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE sender_id=%s AND receiver_id=%s AND read_at IS NULL", (partner[0], my_id))
        conn.commit()
        cur.execute("""
            SELECT u.username, m.message, m.sent_at
            FROM messages m JOIN users u ON u.user_id = m.sender_id
            WHERE (m.sender_id=%s AND m.receiver_id=%s) OR (m.sender_id=%s AND m.receiver_id=%s)
            ORDER BY m.sent_at ASC
        """, (my_id, partner[0], partner[0], my_id))
        messages = [
            {'from': r[0], 'text': r[1], 'time': r[2].strftime('%H:%M') if r[2] else ''}
            for r in cur.fetchall()
        ]
        return jsonify({'success': True, 'messages': messages})
    except Exception as e:
        print(e)
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()



@app.route('/api/chat/read/<partner_username>', methods=['POST'])
def chat_mark_read(partner_username):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        cur.execute('SELECT user_id FROM users WHERE username = %s', (partner_username,))
        partner = cur.fetchone()
        if not partner:
            return jsonify({'success': False, 'error': 'User not found'}), 404
        ensure_message_read_column(cur)
        cur.execute("UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE sender_id=%s AND receiver_id=%s AND read_at IS NULL", (partner[0], session['user_id']))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()

@app.route('/api/chat/send', methods=['POST'])
def chat_send():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data'}), 400
    to_username  = data.get('to', '').strip()
    message_text = data.get('message', '').strip()
    if not to_username or not message_text:
        return jsonify({'success': False, 'error': 'Missing fields'}), 400
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        cur.execute('SELECT user_id FROM users WHERE username = %s', (to_username,))
        receiver = cur.fetchone()
        if not receiver:
            return jsonify({'success': False, 'error': 'Recipient not found'}), 404

        # Check receiver's message permission setting
        cur.execute("SELECT msg_permission FROM users WHERE user_id = %s", (receiver[0],))
        perm_row = cur.fetchone()
        perm     = perm_row[0] if perm_row else 'everyone'
        if perm == 'nobody':
            return jsonify({'success': False, 'error': 'This user is not accepting messages'}), 403
        # 'friends' enforcement goes here once a friends table exists

        ensure_friend_requests_table(cur)
        ensure_message_read_column(cur)
        if friendship_status(cur, session['user_id'], receiver[0]) != 'friends':
            return jsonify({'success': False, 'error': 'You can only message friends'}), 403
        cur.execute(
            'INSERT INTO messages (sender_id, receiver_id, message) VALUES (%s,%s,%s)',
            (session['user_id'], receiver[0], message_text)
        )
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        print(e)
        conn.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


# The chat page search bar calls this to find users by username prefix.
@app.route('/api/users/search', methods=['GET'])
def search_users():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'}), 401
    q = request.args.get('q', '').strip()
    if len(q) < 1:
        return jsonify({'success': True, 'users': []})
    conn, cur = connect_db()
    if conn is None:
        return jsonify({'success': False, 'error': 'Database error'}), 500
    try:
        cur.execute(
            "SELECT username FROM users WHERE username ILIKE %s AND user_id != %s LIMIT 10",
            (f'%{q}%', session['user_id'])
        )
        users = [{'username': r[0]} for r in cur.fetchall()]
        ensure_friend_requests_table(cur)
        conn.commit()
        for u in users:
            other = get_user_id_by_username(cur, u['username'])
            u['friendship_status'] = friendship_status(cur, session['user_id'], other[0]) if other else 'none'
        return jsonify({'success': True, 'users': users})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        cur.close(); conn.close()


# Each client connects to /ws/<username> on chat page load.
# Supports message types: 'message', 'typing', 'stop_typing'.
# connected_users maps username → socket for direct delivery.
if SOCK_AVAILABLE:
    @sock.route('/ws/<username>')
    def websocket(ws, username):
        # Register this socket so other users can look it up by name and send directly to it.
        connected_users[username] = ws
        print(f'[WS] {username} connected. Online: {list(connected_users.keys())}')
        try:
            while True:
                raw = ws.receive()
                # receive() returns None when the client disconnects cleanly break out of the loop.
                if raw is None:
                    break
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                recipient = data.get('to')
                msg_type  = data.get('type', 'message')
                if not recipient:
                    continue

                target_ws = connected_users.get(recipient)
                if target_ws:
                    payload = {'from': username}
                    if msg_type == 'typing':
                        payload['type'] = 'typing'
                    elif msg_type == 'stop_typing':
                        payload['type'] = 'stop_typing'
                    else:
                        payload['type']    = 'message'
                        payload['message'] = data.get('message', '')
                    try:
                        target_ws.send(json.dumps(payload))
                    except Exception:
                        # If the send fails the recipient's socket is broken remove them so
                        # future lookups don't try to use a dead connection.
                        connected_users.pop(recipient, None)
                else:
                    try:
                        ws.send(json.dumps({'system': f'{recipient} is not online right now'}))
                    except Exception:
                        break
        finally:
            # Only remove the entry if it still points to *this* socket a reconnect
            # from the same username could have already replaced it.
            if connected_users.get(username) is ws:
                connected_users.pop(username, None)
            print(f'[WS] {username} disconnected. Online: {list(connected_users.keys())}')

# --- Map WebSocket ---

def fetch_players_for_map():
    conn, cur = connect_db()
    if conn is None:
        return []
    try:
        cur.execute("""
            SELECT user_id, username, status, latitude, longitude, last_active, COALESCE(avatar_seed, username)
            FROM users
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            AND COALESCE(is_invisible, FALSE) = FALSE
            AND COALESCE(status, 'offline') != 'invisible'
            
        """)
        rows = cur.fetchall()
        players = []
        for r in rows:
            uid = r[0]
            cur.execute("""
                SELECT sg.appid, sg.name, sg.icon_url
                FROM steam_games sg
                JOIN user_steam_games usg ON sg.appid = usg.appid
                WHERE usg.user_id = %s
                LIMIT 6
            """, (uid,))
            games = [{'appid': g[0], 'name': g[1], 'icon_url': g[2]} for g in cur.fetchall()]
            players.append({
                'id': uid,
                'gamertag': r[1],
                'status': r[2] or 'offline',
                'lat': float(r[3]),
                'lng': float(r[4]),
                'lastActive': str(r[5]) if r[5] else 'Unknown',
                'avatarSeed': r[6],
                'games': games,
            })
        return players
    except Exception as e:
        print("fetch_players_for_map error:", e)
        return []
    finally:
        cur.close()
        conn.close()

if SOCK_AVAILABLE:
    @sock.route('/ws/map')
    def ws_map(ws):
        connected_map_clients.add(ws)
        print("[WS map] sending snapshot")
        print("[WS map] client connected")
        try:
            ws.send(json.dumps({
                'type': 'players_snapshot',
                'players': fetch_players_for_map()
            }))
            print("[WS map] snapshot sent")
            while True:
                raw = ws.receive()
                if raw is None:
                    break
        except Exception as e:
            print("[WS map] error:", e)
        finally:
            connected_map_clients.discard(ws)
            print("[WS map] client disconnected")     


if __name__ == "__main__":
    if SOCK_AVAILABLE:
        from gevent.pywsgi import WSGIServer
        print("[server] gevent on http://127.0.0.1:5000")
        WSGIServer(("127.0.0.1", 5000), app).serve_forever()
    else:
        app.run(host="127.0.0.1", port=5000, debug=True, use_reloader=False)