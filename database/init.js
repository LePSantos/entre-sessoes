const db = require('./db');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (
            role IN ('PSYCHOLOGIST', 'PATIENT')
        ),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );


    CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        psychologist_id INTEGER NOT NULL,
        phone TEXT,
        birth_date DATE,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
            CHECK (
                status IN (
                    'ACTIVE',
                    'INACTIVE'
                )
            ),
        default_session_price REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id),

        FOREIGN KEY (psychologist_id)
            REFERENCES users(id)
    );


    CREATE TABLE IF NOT EXISTS diary_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        mood_level INTEGER
            CHECK (
                mood_level BETWEEN 1 AND 5
            ),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (patient_id)
            REFERENCES patients(id)
    );


    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        psychologist_id INTEGER NOT NULL,
        scheduled_at DATETIME NOT NULL,

        status TEXT NOT NULL DEFAULT 'SCHEDULED'
            CHECK (
                status IN (
                    'SCHEDULED',
                    'CONFIRMED',
                    'COMPLETED',
                    'CANCELED',
                    'NO_SHOW'
                )
            ),

        price REAL DEFAULT 0,

        payment_status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (
                payment_status IN (
                    'PENDING',
                    'PAID'
                )
            ),

        payment_date DATETIME,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (patient_id)
            REFERENCES patients(id),

        FOREIGN KEY (psychologist_id)
            REFERENCES users(id)
    );


    CREATE TABLE IF NOT EXISTS clinical_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL UNIQUE,
        psychologist_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (session_id)
            REFERENCES sessions(id),

        FOREIGN KEY (psychologist_id)
            REFERENCES users(id)
    );


    CREATE TABLE IF NOT EXISTS support_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        psychologist_id INTEGER NOT NULL,

        status TEXT NOT NULL DEFAULT 'PENDING'
            CHECK (
                status IN (
                    'PENDING',
                    'VIEWED',
                    'RESOLVED'
                )
            ),

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        viewed_at DATETIME,
        resolved_at DATETIME,

        FOREIGN KEY (patient_id)
            REFERENCES patients(id),

        FOREIGN KEY (psychologist_id)
            REFERENCES users(id)
    );


    /* ==================================================
       CONVITES PARA NOVOS PACIENTES
    ================================================== */

    CREATE TABLE IF NOT EXISTS patient_invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        psychologist_id INTEGER NOT NULL,

        token_hash TEXT NOT NULL UNIQUE,

        expires_at DATETIME NOT NULL,

        used_at DATETIME,

        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id)
            REFERENCES users(id),

        FOREIGN KEY (psychologist_id)
            REFERENCES users(id)
    );


    CREATE INDEX IF NOT EXISTS
        idx_patient_invitations_user_id

    ON patient_invitations (
        user_id
    );


    CREATE INDEX IF NOT EXISTS
        idx_patient_invitations_token_hash

    ON patient_invitations (
        token_hash
    );
`);


console.log(
    'Todas as tabelas foram criadas com sucesso.'
);


db.close();