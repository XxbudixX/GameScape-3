import psycopg2 as psql
import configparser
import os

# main.py runs gevent's monkey.patch_all(), which patches Python sockets to be
# cooperative. psycopg2 uses a native C socket that gevent can't yield on, so
# without this, a query that waits on the network blocks the whole process and
# can hang indefinitely (especially against Supabase's pooler). psycogreen makes
# psycopg2 cooperate with gevent. Wrapped in try/except so the app still runs if
try:
    from psycogreen.gevent import patch_psycopg
    patch_psycopg()
except Exception:
    pass


# Opens a connection to the PostgreSQL database using credentials from config.ini.
# The path to config.ini is resolved relative to this file's location, not wherever
# the script happens to be run from. That way it works correctly regardless of the
# working directory (e.g. when Flask runs from a different folder).
# No input. Returns a tuple of (connection, cursor) on success, or (None, None) on failure.
def connect_db():
    config = configparser.ConfigParser()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, 'config.ini')
    config.read(config_path)

    db_config = {
        'host':     config['database']['host'].strip(),
        'user':     config['database']['user'].strip(),
        'port':     config['database']['port'].strip(),
        'password': config['database']['password'].strip(),
        'dbname':   config['database']['database'].strip(),
        'sslmode':  'require',  
        'connect_timeout': 10,  
        'options': '-c statement_timeout=15000'
    }

    try:
        connection = psql.connect(**db_config)
        print('uppkopplad till databasen')
        cursor = connection.cursor()
        # Set the search path so queries don't need to prefix table names with the schema
        cursor.execute("SET search_path TO public")
        return connection, cursor

    except Exception as e:
        print("Fel i anslutning till databasen")
        print(e)
        return None, None


# Allows this file to be run directly to test the database connection without starting Flask.
if __name__ == "__main__":
    connect_db()