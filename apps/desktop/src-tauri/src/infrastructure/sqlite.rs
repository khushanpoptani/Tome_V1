use std::path::Path;

use rusqlite::Connection;

/// Opens Tome's local SQLite connection without assuming a schema or migration
/// strategy. Those contracts remain an explicit architecture decision.
pub fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open(path)
}

#[cfg(test)]
mod tests {
    use super::open_connection;
    use std::path::Path;

    #[test]
    fn opens_an_in_memory_database() {
        let connection = open_connection(Path::new(":memory:"));

        assert!(connection.is_ok());
    }
}
