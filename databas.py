import psycopg2 as psql
import configparser
import os


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
        'sslmode':  'require'   # SSL is required because the database is hosted remotely on Supabase
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
