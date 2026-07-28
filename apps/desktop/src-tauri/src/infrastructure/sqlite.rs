use std::{fs, path::Path, time::Duration};

use rusqlite::Connection;

pub fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| {
            rusqlite::Error::InvalidPath(parent.join(format!("creation failed: {error}")))
        })?;
    }

    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 0,
            last_status TEXT,
            last_ping_ms INTEGER,
            last_version TEXT,
            last_error TEXT,
            last_tested_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS connection_history (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL,
            status TEXT NOT NULL,
            ping_ms INTEGER,
            version TEXT,
            error TEXT,
            tested_at TEXT NOT NULL,
            FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            model TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            attachments_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            progress REAL NOT NULL DEFAULT 0,
            started_at TEXT,
            ended_at TEXT,
            logs TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS installed_models (
            server_id TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            digest TEXT,
            modified_at TEXT,
            details_json TEXT NOT NULL DEFAULT '{}',
            tested_at TEXT,
            test_status TEXT,
            test_error TEXT,
            PRIMARY KEY(server_id, name),
            FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS model_tests (
            server_id TEXT NOT NULL,
            model TEXT NOT NULL,
            tested_at TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT,
            PRIMARY KEY(server_id, model),
            FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (1, datetime('now'));
        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (2, datetime('now'));
        "#,
    )?;

    let has_v3 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 3)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v3 {
        connection.execute_batch(
            r#"
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;

        CREATE TABLE projects_v3 (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            archived_at TEXT,
            duplicate_of TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_opened_at TEXT NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
            FOREIGN KEY(duplicate_of) REFERENCES projects_v3(id) ON DELETE SET NULL
        );

        INSERT INTO projects_v3(
            id, workspace_id, name, path, archived_at, duplicate_of,
            created_at, updated_at, last_opened_at
        )
        SELECT id, workspace_id, name, path, NULL, NULL,
               created_at, updated_at, last_opened_at
        FROM projects;

        DROP TABLE projects;
        ALTER TABLE projects_v3 RENAME TO projects;
        CREATE INDEX idx_projects_archived ON projects(archived_at, last_opened_at DESC);

        ALTER TABLE conversations
            ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        ALTER TABLE conversations ADD COLUMN archived_at TEXT;
        ALTER TABLE conversations
            ADD COLUMN duplicate_of TEXT REFERENCES conversations(id) ON DELETE SET NULL;
        CREATE INDEX idx_conversations_project
            ON conversations(project_id, archived_at, updated_at DESC);

        CREATE TABLE training_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            adapter TEXT NOT NULL DEFAULT 'tome-training-v1',
            credential_ref TEXT,
            is_active INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'unknown',
            version TEXT,
            capabilities_json TEXT NOT NULL DEFAULT '{}',
            last_error TEXT,
            last_checked_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE training_datasets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_path TEXT NOT NULL,
            artifact_path TEXT,
            format TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            file_count INTEGER NOT NULL DEFAULT 0,
            checksum TEXT,
            compressed INTEGER NOT NULL DEFAULT 0,
            validation_status TEXT NOT NULL DEFAULT 'pending',
            validation_errors_json TEXT NOT NULL DEFAULT '[]',
            preview TEXT,
            remote_dataset_id TEXT,
            training_server_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(training_server_id) REFERENCES training_servers(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_training_datasets_updated
            ON training_datasets(updated_at DESC);

        CREATE TABLE dataset_uploads (
            id TEXT PRIMARY KEY,
            dataset_id TEXT NOT NULL,
            training_server_id TEXT NOT NULL,
            remote_upload_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            bytes_uploaded INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            chunk_size INTEGER NOT NULL DEFAULT 4194304,
            speed_bps REAL NOT NULL DEFAULT 0,
            eta_seconds INTEGER,
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(dataset_id) REFERENCES training_datasets(id) ON DELETE CASCADE,
            FOREIGN KEY(training_server_id) REFERENCES training_servers(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_dataset_uploads_status
            ON dataset_uploads(status, updated_at DESC);

        CREATE TABLE training_jobs (
            id TEXT PRIMARY KEY,
            training_server_id TEXT,
            remote_job_id TEXT,
            dataset_id TEXT NOT NULL,
            model TEXT NOT NULL,
            backend TEXT NOT NULL,
            parameters_json TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'draft',
            stage TEXT NOT NULL DEFAULT 'Draft',
            progress REAL NOT NULL DEFAULT 0,
            eta_seconds INTEGER,
            started_at TEXT,
            finished_at TEXT,
            gpu_usage REAL,
            cpu_usage REAL,
            ram_usage INTEGER,
            disk_usage INTEGER,
            current_epoch INTEGER NOT NULL DEFAULT 0,
            total_epochs INTEGER NOT NULL DEFAULT 0,
            loss REAL,
            learning_rate REAL,
            heartbeat_at TEXT,
            warning TEXT,
            error TEXT,
            retry_of TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(training_server_id) REFERENCES training_servers(id) ON DELETE SET NULL,
            FOREIGN KEY(dataset_id) REFERENCES training_datasets(id) ON DELETE RESTRICT,
            FOREIGN KEY(retry_of) REFERENCES training_jobs(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_training_jobs_status
            ON training_jobs(status, updated_at DESC);

        CREATE TABLE training_resources (
            training_server_id TEXT PRIMARY KEY,
            gpu_json TEXT NOT NULL DEFAULT '[]',
            cpu_usage REAL,
            ram_total INTEGER,
            ram_used INTEGER,
            disk_total INTEGER,
            disk_used INTEGER,
            queue_length INTEGER NOT NULL DEFAULT 0,
            captured_at TEXT NOT NULL,
            FOREIGN KEY(training_server_id) REFERENCES training_servers(id) ON DELETE CASCADE
        );

        CREATE TABLE training_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            training_job_id TEXT,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            cursor TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(training_job_id) REFERENCES training_jobs(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_training_logs_job
            ON training_logs(training_job_id, id DESC);

        INSERT INTO schema_migrations(version, applied_at)
        VALUES (3, datetime('now'));

        COMMIT;
        PRAGMA foreign_keys = ON;
        "#,
        )?;
    }

    let has_v4 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 4)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v4 {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            ALTER TABLE training_jobs
                ADD COLUMN base_model TEXT NOT NULL DEFAULT '';
            ALTER TABLE training_jobs
                ADD COLUMN training_speed REAL;
            INSERT INTO schema_migrations(version, applied_at)
            VALUES (4, datetime('now'));
            COMMIT;
            "#,
        )?;
    }

    let has_v5 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 5)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v5 {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            ALTER TABLE training_jobs
                ADD COLUMN heartbeat_failures INTEGER NOT NULL DEFAULT 0;
            INSERT INTO schema_migrations(version, applied_at)
            VALUES (5, datetime('now'));
            COMMIT;
            "#,
        )?;
    }

    let has_v6 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 6)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v6 {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            ALTER TABLE training_jobs
                ADD COLUMN dataset_ids_json TEXT NOT NULL DEFAULT '[]';
            UPDATE training_jobs
            SET dataset_ids_json='["' || dataset_id || '"]'
            WHERE dataset_ids_json='[]';
            INSERT INTO schema_migrations(version, applied_at)
            VALUES (6, datetime('now'));
            COMMIT;
            "#,
        )?;
    }

    let has_v7 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 7)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v7 {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            CREATE TABLE training_dataset_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ALTER TABLE training_datasets
                ADD COLUMN group_id TEXT
                REFERENCES training_dataset_groups(id) ON DELETE SET NULL;
            CREATE INDEX idx_training_datasets_group
                ON training_datasets(group_id, updated_at DESC);
            INSERT INTO schema_migrations(version, applied_at)
            VALUES (7, datetime('now'));
            COMMIT;
            "#,
        )?;
    }

    let has_v8 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 8)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v8 {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            DELETE FROM tasks
            WHERE kind='dataset-upload'
              AND id NOT IN (SELECT id FROM dataset_uploads);
            INSERT INTO schema_migrations(version, applied_at)
            VALUES (8, datetime('now'));
            COMMIT;
            "#,
        )?;
    }

    let has_v9 = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 9)",
        [],
        |row| row.get::<_, i64>(0),
    )? != 0;
    if !has_v9 {
        connection.execute_batch(
            r#"
            BEGIN IMMEDIATE;
            UPDATE tasks
            SET status='completed',
                ended_at=COALESCE(ended_at, updated_at),
                updated_at=datetime('now')
            WHERE kind='dataset-preparation'
              AND status='running'
              AND progress >= 100
              AND EXISTS (
                  SELECT 1
                  FROM training_datasets
                  WHERE 'dataset-prepare:' || training_datasets.id = tasks.id
                    AND training_datasets.validation_status = 'valid'
              );
            UPDATE tasks
            SET status='failed',
                ended_at=COALESCE(ended_at, updated_at),
                updated_at=datetime('now')
            WHERE kind='dataset-preparation'
              AND status='running'
              AND progress >= 100
              AND EXISTS (
                  SELECT 1
                  FROM training_datasets
                  WHERE 'dataset-prepare:' || training_datasets.id = tasks.id
                    AND training_datasets.validation_status != 'valid'
              );
            INSERT INTO schema_migrations(version, applied_at)
            VALUES (9, datetime('now'));
            COMMIT;
            "#,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{migrate, open_connection};
    use rusqlite::Connection;
    use std::path::Path;

    #[test]
    fn opens_an_in_memory_database() {
        let connection = open_connection(Path::new(":memory:"));

        assert!(connection.is_ok());
    }

    #[test]
    fn installs_project_hierarchy_and_training_schema() {
        let connection = open_connection(Path::new(":memory:")).expect("database should open");

        let version = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("schema version should be readable");
        assert_eq!(version, 9);
        for table in [
            "training_servers",
            "training_dataset_groups",
            "training_datasets",
            "dataset_uploads",
            "training_jobs",
            "training_resources",
            "training_logs",
        ] {
            assert!(has_table(&connection, table), "missing table {table}");
        }
        assert!(has_column(&connection, "projects", "archived_at"));
        assert!(has_column(&connection, "conversations", "project_id"));
        assert!(has_column(&connection, "training_jobs", "base_model"));
        assert!(has_column(&connection, "training_jobs", "training_speed"));
        assert!(has_column(
            &connection,
            "training_jobs",
            "heartbeat_failures"
        ));
        assert!(has_column(&connection, "training_jobs", "dataset_ids_json"));
        assert!(has_column(&connection, "training_datasets", "group_id"));
    }

    #[test]
    fn recovers_completed_dataset_preparation_tasks_from_version_eight() {
        let connection = open_connection(Path::new(":memory:")).expect("database should open");
        connection
            .execute(
                "INSERT INTO training_datasets(
                    id, name, source_path, format, size, file_count, compressed,
                    validation_status, validation_errors_json, created_at, updated_at
                 ) VALUES (
                    'dataset', 'Dataset', '/tmp/dataset', 'jsonl', 1024, 1, 1,
                    'valid', '[]', datetime('now'), datetime('now')
                 )",
                [],
            )
            .expect("dataset should be inserted");
        connection
            .execute(
                "INSERT INTO tasks(
                    id, kind, title, status, progress, logs, created_at, updated_at
                 ) VALUES (
                    'dataset-prepare:dataset', 'dataset-preparation', 'Prepare Dataset',
                    'running', 100, 'Ready for Upload: Validation complete',
                    datetime('now'), datetime('now')
                 )",
                [],
            )
            .expect("task should be inserted");
        connection
            .execute("DELETE FROM schema_migrations WHERE version = 9", [])
            .expect("version nine should be removed");

        migrate(&connection).expect("version nine should be reapplied");

        let (status, ended_at) = connection
            .query_row(
                "SELECT status, ended_at FROM tasks WHERE id='dataset-prepare:dataset'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .expect("task should be readable");
        assert_eq!(status, "completed");
        assert!(ended_at.is_some());
    }

    fn has_table(connection: &Connection, table: &str) -> bool {
        connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
                 )",
                [table],
                |row| row.get::<_, i64>(0),
            )
            .is_ok_and(|value| value == 1)
    }

    fn has_column(connection: &Connection, table: &str, column: &str) -> bool {
        connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .and_then(|mut statement| {
                let values = statement
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(values)
            })
            .is_ok_and(|values| values.iter().any(|value| value == column))
    }
}
