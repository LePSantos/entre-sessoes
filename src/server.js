require('dotenv').config();

const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const webpush = require('web-push');

const db = require('../database/db');
const registerPatientInvitationRoutes = require('./patient-invitations');

const app = express();

const PORT =
    process.env.PORT || 3000;

    // ======================================================
// WEB PUSH
// ======================================================

webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// ======================================================
// ENVIAR NOTIFICAÇÃO PRIORITÁRIA
// ======================================================

async function sendPriorityNotification(
    psychologistId
) {

    const subscriptions =
        db.prepare(`
            SELECT
                id,
                subscription_json

            FROM push_subscriptions

            WHERE psychologist_id = ?
        `).all(
            psychologistId
        );


    const payload =
        JSON.stringify({
            title:
                'EntreSessões',

            body:
                'Nova solicitação prioritária. Um paciente solicitou contato.',

            url:
                '/support-requests'
        });


    for (
        const item of subscriptions
    ) {

        try {

            const subscription =
                JSON.parse(
                    item.subscription_json
                );


            await webpush.sendNotification(
                subscription,
                payload
            );


        } catch (error) {

            console.error(
                'Erro ao enviar notificação:',
                error
            );


            if (
                error.statusCode === 404 ||
                error.statusCode === 410
            ) {

                db.prepare(`
                    DELETE FROM push_subscriptions
                    WHERE id = ?
                `).run(
                    item.id
                );
            }
        }
    }
}

// ======================================================
// ASSINATURAS DE NOTIFICAÇÃO
// ======================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        psychologist_id INTEGER NOT NULL,

        endpoint TEXT NOT NULL UNIQUE,

        subscription_json TEXT NOT NULL,

        created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

        updated_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (
            psychologist_id
        )
        REFERENCES users(id)
    )
`).run();

// ======================================================
// CAMPOS EXTRAS DE PAGAMENTO
// ======================================================

const sessionColumns =
    db.prepare(`
        PRAGMA table_info(sessions)
    `).all();


if (
    !sessionColumns.some(
        column =>
            column.name === 'payment_method'
    )
) {

    db.prepare(`
        ALTER TABLE sessions
        ADD COLUMN payment_method TEXT
    `).run();
}


if (
    !sessionColumns.some(
        column =>
            column.name === 'payment_installments'
    )
) {

    db.prepare(`
        ALTER TABLE sessions
        ADD COLUMN payment_installments INTEGER
    `).run();
}

// ======================================================
// HORÁRIOS DISPONÍVEIS PARA AGENDAMENTO
// ======================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS availability_slots (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        psychologist_id INTEGER NOT NULL,

        starts_at TEXT NOT NULL,

        status TEXT NOT NULL
            DEFAULT 'OPEN'
            CHECK (
                status IN (
                    'OPEN',
                    'BOOKED',
                    'CANCELED'
                )
            ),

        created_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

        updated_at DATETIME
            DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (
            psychologist_id
        )
        REFERENCES users(id),

        UNIQUE (
            psychologist_id,
            starts_at
        )
    )
`).run();

// ======================================================
// CONFIGURAÇÕES
// ======================================================

app.set(
    'view engine',
    'ejs'
);

app.set(
    'views',
    path.join(
        __dirname,
        '../views'
    )
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.json()
);

app.use(
    express.static(
        path.join(
            __dirname,
            '../public'
        )
    )
);


// ======================================================
// SESSÃO
// ======================================================

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            'entresessoes_dev_2026',

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: 'lax',

            maxAge:
                1000 *
                60 *
                60 *
                8
        }
    })
);


// ======================================================
// AUTENTICAÇÃO
// ======================================================

function requireAuth(
    req,
    res,
    next
) {

    if (
        !req.session.user
    ) {

        return res.redirect(
            '/login'
        );
    }

    next();
}


// ======================================================
// ALERTA GLOBAL DE SOLICITAÇÃO PRIORITÁRIA
// IMPORTANTE:
// precisa ficar ANTES das rotas da psicóloga
// ======================================================

app.use(
    (req, res, next) => {

        res.locals.priorityAlert =
            null;


        if (
            req.session.user &&
            req.session.user.role ===
                'PSYCHOLOGIST'
        ) {

            const priorityAlert =
                db.prepare(`
                    SELECT
                        support_requests.id,
                        support_requests.patient_id,
                        support_requests.created_at,

                        users.name
                            AS patient_name,

                        strftime(
                            '%d/%m/%Y %H:%M',
                            support_requests.created_at,
                            'localtime'
                        )
                            AS created_at_formatted

                    FROM support_requests

                    INNER JOIN patients
                        ON patients.id =
                        support_requests.patient_id

                    INNER JOIN users
                        ON users.id =
                        patients.user_id

                    WHERE
                        support_requests.psychologist_id
                        = ?

                    AND
                        support_requests.status =
                        'PENDING'

                    ORDER BY
                        support_requests.created_at
                        DESC

                    LIMIT 1
                `).get(
                    req.session.user.id
                );


            res.locals.priorityAlert =
                priorityAlert || null;
        }


        next();
    }
);


// ======================================================
// ROTA INICIAL
// ======================================================

app.get(
    '/',

    (req, res) => {

        if (
            !req.session.user
        ) {

            return res.redirect(
                '/login'
            );
        }


        if (
            req.session.user.role ===
            'PSYCHOLOGIST'
        ) {

            return res.redirect(
                '/dashboard'
            );
        }


        if (
            req.session.user.role ===
            'PATIENT'
        ) {

            return res.redirect(
                '/patient/dashboard'
            );
        }


        return res.redirect(
            '/login'
        );
    }
);

// ======================================================
// ESCOLHER FORMA DE PAGAMENTO
// ======================================================

app.get(
    '/patient/payments/:sessionId/pay',

    requireAuth,

    (req, res) => {

        if (req.session.user.role !== 'PATIENT') {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);


        if (!Number.isInteger(sessionId)) {

            return res
                .status(400)
                .send(
                    'Sessão inválida.'
                );
        }


        const patient = db.prepare(`
            SELECT id

            FROM patients

            WHERE user_id = ?
        `).get(
            req.session.user.id
        );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const payment = db.prepare(`
            SELECT
                sessions.id,
                sessions.price,
                sessions.payment_status,
                sessions.scheduled_at,

                users.name
                    AS psychologist_name,

                strftime(
                    '%d/%m/%Y',
                    sessions.scheduled_at
                ) AS date_formatted,

                strftime(
                    '%H:%M',
                    sessions.scheduled_at
                ) AS time_formatted

            FROM sessions

            INNER JOIN users
                ON users.id =
                sessions.psychologist_id

            WHERE sessions.id = ?

            AND sessions.patient_id = ?
        `).get(
            sessionId,
            patient.id
        );


        if (!payment) {

            return res
                .status(404)
                .send(
                    'Sessão não encontrada.'
                );
        }


        if (
            payment.payment_status === 'PAID'
        ) {

            return res.redirect(
                '/patient/payments'
            );
        }


        return res.render(
            'patient-payment-method',
            {
                user:
                    req.session.user,

                payment
            }
        );
    }
);

// ======================================================
// PIX - DEMONSTRAÇÃO
// ======================================================

app.get(
    '/patient/payments/:sessionId/pix',

    requireAuth,

    (req, res) => {

        if (req.session.user.role !== 'PATIENT') {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);


        if (!Number.isInteger(sessionId)) {

            return res
                .status(400)
                .send('Sessão inválida.');
        }


        const patient = db.prepare(`
            SELECT id

            FROM patients

            WHERE user_id = ?
        `).get(
            req.session.user.id
        );


        if (!patient) {

            return res
                .status(404)
                .send('Paciente não encontrado.');
        }


        const payment = db.prepare(`
            SELECT
                sessions.id,
                sessions.price,
                sessions.payment_status,

                users.name AS psychologist_name,

                strftime(
                    '%d/%m/%Y',
                    sessions.scheduled_at
                ) AS date_formatted,

                strftime(
                    '%H:%M',
                    sessions.scheduled_at
                ) AS time_formatted

            FROM sessions

            INNER JOIN users
                ON users.id =
                sessions.psychologist_id

            WHERE sessions.id = ?

            AND sessions.patient_id = ?
        `).get(
            sessionId,
            patient.id
        );


        if (!payment) {

            return res
                .status(404)
                .send('Sessão não encontrada.');
        }


        if (payment.payment_status === 'PAID') {

            return res.redirect(
                '/patient/payments'
            );
        }


        return res.render(
            'patient-payment-pix',
            {
                user: req.session.user,
                payment
            }
        );
    }
);


// SIMULAR APROVAÇÃO DO PIX

app.post(
    '/patient/payments/:sessionId/pix/confirm',

    requireAuth,

    (req, res) => {

        if (req.session.user.role !== 'PATIENT') {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);


        const patient = db.prepare(`
            SELECT id

            FROM patients

            WHERE user_id = ?
        `).get(
            req.session.user.id
        );


        if (
            !patient ||
            !Number.isInteger(sessionId)
        ) {

            return res
                .status(400)
                .send('Pagamento inválido.');
        }


        const result = db.prepare(`
            UPDATE sessions

SET
    payment_status = 'PAID',

    payment_date = CURRENT_TIMESTAMP,

    payment_method = 'PIX',

    payment_installments = NULL,

    updated_at = CURRENT_TIMESTAMP

            WHERE id = ?

            AND patient_id = ?

            AND payment_status = 'PENDING'
        `).run(
            sessionId,
            patient.id
        );


        if (result.changes === 0) {

            return res
                .status(400)
                .send(
                    'Este pagamento não está disponível.'
                );
        }


        return res.redirect(
            '/patient/payments'
        );
    }
);

// ======================================================
// CARTÃO DE CRÉDITO - DEMONSTRAÇÃO
// ======================================================

app.get(
    '/patient/payments/:sessionId/credit',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !== 'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);


        if (
            !Number.isInteger(sessionId)
        ) {

            return res
                .status(400)
                .send(
                    'Sessão inválida.'
                );
        }


        const patient =
            db.prepare(`
                SELECT id

                FROM patients

                WHERE user_id = ?
            `).get(
                req.session.user.id
            );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const payment =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.price,
                    sessions.payment_status,

                    users.name
                        AS psychologist_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                INNER JOIN users
                    ON users.id =
                    sessions.psychologist_id

                WHERE sessions.id = ?

                AND sessions.patient_id = ?
            `).get(
                sessionId,
                patient.id
            );


        if (!payment) {

            return res
                .status(404)
                .send(
                    'Sessão não encontrada.'
                );
        }


        if (
            payment.payment_status === 'PAID'
        ) {

            return res.redirect(
                '/patient/payments'
            );
        }


        return res.render(
            'patient-payment-credit',
            {
                user:
                    req.session.user,

                payment
            }
        );
    }
);


// SIMULAR APROVAÇÃO DO CARTÃO

app.post(
    '/patient/payments/:sessionId/credit/confirm',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !== 'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);

        const installments =
            Number(req.body.installments);


        if (
            !Number.isInteger(sessionId)
            ||
            !Number.isInteger(installments)
            ||
            installments < 1
            ||
            installments > 6
        ) {

            return res
                .status(400)
                .send(
                    'Pagamento inválido.'
                );
        }


        const patient =
            db.prepare(`
                SELECT id

                FROM patients

                WHERE user_id = ?
            `).get(
                req.session.user.id
            );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const result =
            db.prepare(`
                UPDATE sessions

                SET
                    payment_status = 'PAID',

                    payment_date =
                        CURRENT_TIMESTAMP,

                    payment_method =
                        'CREDIT',

                    payment_installments = ?,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?

                AND patient_id = ?

                AND payment_status = 'PENDING'
            `).run(
                installments,
                sessionId,
                patient.id
            );


        if (
            result.changes === 0
        ) {

            return res
                .status(400)
                .send(
                    'Este pagamento não está disponível.'
                );
        }


        return res.redirect(
            '/patient/payments'
        );
    }
);

// ======================================================
// CARTÃO DE DÉBITO - DEMONSTRAÇÃO
// ======================================================

app.get(
    '/patient/payments/:sessionId/debit',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !== 'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);


        if (
            !Number.isInteger(sessionId)
        ) {

            return res
                .status(400)
                .send(
                    'Sessão inválida.'
                );
        }


        const patient =
            db.prepare(`
                SELECT id

                FROM patients

                WHERE user_id = ?
            `).get(
                req.session.user.id
            );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const payment =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.price,
                    sessions.payment_status,

                    users.name
                        AS psychologist_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    ) AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    ) AS time_formatted

                FROM sessions

                INNER JOIN users
                    ON users.id =
                    sessions.psychologist_id

                WHERE sessions.id = ?

                AND sessions.patient_id = ?
            `).get(
                sessionId,
                patient.id
            );


        if (!payment) {

            return res
                .status(404)
                .send(
                    'Sessão não encontrada.'
                );
        }


        if (
            payment.payment_status === 'PAID'
        ) {

            return res.redirect(
                '/patient/payments'
            );
        }


        return res.render(
            'patient-payment-debit',
            {
                user:
                    req.session.user,

                payment
            }
        );
    }
);


// SIMULAR APROVAÇÃO DO DÉBITO

app.post(
    '/patient/payments/:sessionId/debit/confirm',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !== 'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const sessionId =
            Number(req.params.sessionId);


        if (
            !Number.isInteger(sessionId)
        ) {

            return res
                .status(400)
                .send(
                    'Pagamento inválido.'
                );
        }


        const patient =
            db.prepare(`
                SELECT id

                FROM patients

                WHERE user_id = ?
            `).get(
                req.session.user.id
            );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const result =
            db.prepare(`
                UPDATE sessions

                SET
                    payment_status = 'PAID',

                    payment_date =
                        CURRENT_TIMESTAMP,

                    payment_method =
                        'DEBIT',

                    payment_installments = NULL,

                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?

                AND patient_id = ?

                AND payment_status = 'PENDING'
            `).run(
                sessionId,
                patient.id
            );


        if (
            result.changes === 0
        ) {

            return res
                .status(400)
                .send(
                    'Este pagamento não está disponível.'
                );
        }


        return res.redirect(
            '/patient/payments'
        );
    }
);

// ======================================================
// LOGIN
// ======================================================

app.get(
    '/login',

    (req, res) => {

        if (
            req.session.user
        ) {

            if (
                req.session.user.role ===
                'PSYCHOLOGIST'
            ) {

                return res.redirect(
                    '/dashboard'
                );
            }


            if (
                req.session.user.role ===
                'PATIENT'
            ) {

                return res.redirect(
                    '/patient/dashboard'
                );
            }
        }


        return res.render(
            'login',
            {
                error: null
            }
        );
    }
);


app.post(
    '/login',

    (req, res) => {

        const {
            email,
            password
        } = req.body;


        const normalizedEmail =
            String(
                email || ''
            )
                .trim()
                .toLowerCase();


        const user =
            db.prepare(`
                SELECT *

                FROM users

                WHERE LOWER(email) = ?
            `).get(
                normalizedEmail
            );


        if (
            !user
        ) {

            return res.render(
                'login',
                {
                    error:
                        'E-mail ou senha inválidos.'
                }
            );
        }


        const passwordIsValid =
            bcrypt.compareSync(
                password || '',
                user.password_hash
            );


        if (
            !passwordIsValid
        ) {

            return res.render(
                'login',
                {
                    error:
                        'E-mail ou senha inválidos.'
                }
            );
        }


        req.session.user = {
            id: user.id,
            name: user.name,
            role: user.role
        };


        if (
            user.role ===
            'PSYCHOLOGIST'
        ) {

            return res.redirect(
                '/dashboard'
            );
        }


        if (
            user.role ===
            'PATIENT'
        ) {

            return res.redirect(
                '/patient/dashboard'
            );
        }


        return res.redirect(
            '/login'
        );
    }
);

// ======================================================
// WEB PUSH - PSICÓLOGA
// ======================================================


// ======================================================
// RETORNAR CHAVE PÚBLICA
// ======================================================

app.get(
    '/push/public-key',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .json({
                    error:
                        'Acesso não autorizado.'
                });
        }


        return res.json({
            publicKey:
                process.env.VAPID_PUBLIC_KEY
        });
    }
);


// ======================================================
// SALVAR ASSINATURA DO NAVEGADOR
// ======================================================

app.post(
    '/push/subscribe',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .json({
                    error:
                        'Acesso não autorizado.'
                });
        }


        const subscription =
            req.body;


        if (
            !subscription ||
            !subscription.endpoint
        ) {

            return res
                .status(400)
                .json({
                    error:
                        'Assinatura inválida.'
                });
        }


        db.prepare(`
            INSERT INTO push_subscriptions (
                psychologist_id,
                endpoint,
                subscription_json
            )

            VALUES (?, ?, ?)

            ON CONFLICT(endpoint)

            DO UPDATE SET
                psychologist_id =
                    excluded.psychologist_id,

                subscription_json =
                    excluded.subscription_json,

                updated_at =
                    CURRENT_TIMESTAMP
        `).run(
            req.session.user.id,

            subscription.endpoint,

            JSON.stringify(
                subscription
            )
        );


        return res.json({
            success: true
        });
    }
);


// ======================================================
// TESTE DE NOTIFICAÇÃO PUSH
// ======================================================

app.post(
    '/push/test',

    requireAuth,

    async (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Acesso não autorizado.'
                );
        }


        const subscriptions =
            db.prepare(`
                SELECT
                    id,
                    subscription_json

                FROM push_subscriptions

                WHERE psychologist_id = ?
            `).all(
                req.session.user.id
            );


        console.log(
            'ASSINATURAS ENCONTRADAS:',
            subscriptions.length
        );


        if (
            subscriptions.length === 0
        ) {

            return res.send(`
                <h2>Nenhum dispositivo cadastrado.</h2>

                <p>
                    Volte ao Dashboard e clique primeiro
                    em "Ativar notificações".
                </p>

                <a href="/dashboard">
                    Voltar
                </a>
            `);
        }


        const payload =
            JSON.stringify({
                title:
                    'EntreSessões',

                body:
                    'Teste de notificação prioritária.',

                url:
                    '/support-requests'
            });


        let sent = 0;
        let failed = 0;


        for (
            const item of subscriptions
        ) {

            try {

                const subscription =
                    JSON.parse(
                        item.subscription_json
                    );


                await webpush.sendNotification(
                    subscription,
                    payload
                );


                sent++;


                console.log(
                    'PUSH ENVIADO COM SUCESSO.'
                );


            } catch (error) {

                failed++;


                console.error(
                    'ERRO NO PUSH:',
                    error.statusCode,
                    error.body ||
                    error.message
                );


                if (
                    error.statusCode === 404 ||
                    error.statusCode === 410
                ) {

                    db.prepare(`
                        DELETE FROM push_subscriptions

                        WHERE id = ?
                    `).run(
                        item.id
                    );
                }
            }
        }


        return res.send(`
            <h2>Teste de notificação concluído</h2>

            <p>
                Enviadas com sucesso:
                <strong>${sent}</strong>
            </p>

            <p>
                Falharam:
                <strong>${failed}</strong>
            </p>

            <a href="/dashboard">
                Voltar ao Dashboard
            </a>
        `);
    }
);

// ======================================================
// DASHBOARD DA PSICÓLOGA
// ======================================================

app.get(
    '/dashboard',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const psychologistId =
            req.session.user.id;


        // PACIENTES ATIVOS

        const activePatients =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM patients

                WHERE
                    psychologist_id = ?

                AND
                    status = 'ACTIVE'
            `).get(
                psychologistId
            );


        // SESSÕES DE HOJE

        const todaySessions =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM sessions

                WHERE
                    psychologist_id = ?

                AND
                    date(
                        scheduled_at
                    ) =
                    date(
                        'now',
                        'localtime'
                    )

                AND
                    status !=
                    'CANCELED'
            `).get(
                psychologistId
            );


        // SOLICITAÇÕES ABERTAS

        const activeRequests =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM support_requests

                WHERE
                    psychologist_id = ?

                AND
                    status IN (
                        'PENDING',
                        'VIEWED'
                    )
            `).get(
                psychologistId
            );


        // VALORES PENDENTES

        const pendingAmount =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(price),
                        0
                    ) AS total

                FROM sessions

                WHERE
                    psychologist_id = ?

                AND
                    payment_status =
                    'PENDING'

                AND
                    status !=
                    'CANCELED'
            `).get(
                psychologistId
            );


        // PRÓXIMAS SESSÕES

        const upcomingSessions =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.scheduled_at,
                    sessions.status,

                    users.name
                        AS patient_name,

                    strftime(
                        '%d/%m',
                        sessions.scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                INNER JOIN patients
                    ON patients.id =
                    sessions.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    sessions.psychologist_id
                    = ?

                AND
                    datetime(
                        sessions.scheduled_at
                    ) >=
                    datetime(
                        'now',
                        'localtime'
                    )

                AND
                    sessions.status IN (
                        'SCHEDULED',
                        'CONFIRMED'
                    )

                ORDER BY
                    datetime(
                        sessions.scheduled_at
                    ) ASC

                LIMIT 5
            `).all(
                psychologistId
            );


        // SOLICITAÇÕES PRIORITÁRIAS

        const supportRequests =
            db.prepare(`
                SELECT
                    support_requests.id,
                    support_requests.patient_id,
                    support_requests.status,

                    users.name
                        AS patient_name,

                    strftime(
                        '%d/%m/%Y %H:%M',
                        support_requests.created_at,
                        'localtime'
                    )
                        AS created_at_formatted

                FROM support_requests

                INNER JOIN patients
                    ON patients.id =
                    support_requests.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    support_requests.psychologist_id
                    = ?

                AND
                    support_requests.status
                    IN (
                        'PENDING',
                        'VIEWED'
                    )

                ORDER BY
                    support_requests.created_at
                    DESC

                LIMIT 5
            `).all(
                psychologistId
            );


        // PRIMEIRO NOME

        const cleanName =
            req.session.user.name
                .replace(
                    /^Dra\.\s*/i,
                    ''
                );


        const firstName =
            cleanName
                .split(' ')[0];


        return res.render(
            'dashboard',
            {
                user:
                    req.session.user,

                firstName,

                activePatients:
                    activePatients.total,

                todaySessions:
                    todaySessions.total,

                activeRequests:
                    activeRequests.total,

                pendingAmount:
                    pendingAmount.total,

                upcomingSessions,

                supportRequests
            }
        );
    }
);


// ======================================================
// DASHBOARD DO PACIENTE
// ======================================================

app.get(
    '/patient/dashboard',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        return res.render(
            'patient-dashboard',
            {
                user:
                    req.session.user
            }
        );
    }
);

// ======================================================
// MINHAS SESSÕES - PACIENTE
// ======================================================

app.get(
    '/patient/sessions',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patient =
            db.prepare(`
                SELECT
                    id,
                    psychologist_id

                FROM patients

                WHERE user_id = ?
            `).get(
                req.session.user.id
            );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const sessions =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.scheduled_at,
                    sessions.status,
                    sessions.price,
                    sessions.payment_status,

                    users.name
                        AS psychologist_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                INNER JOIN users
                    ON users.id =
                    sessions.psychologist_id

                WHERE
                    sessions.patient_id = ?

                ORDER BY
                    datetime(
                        sessions.scheduled_at
                    ) DESC
            `).all(
                patient.id
            );


        return res.render(
            'patient-sessions',
            {
                user:
                    req.session.user,

                sessions
            }
        );
    }
);

// ======================================================
// PAGAMENTOS - PACIENTE
// ======================================================

app.get(
    '/patient/payments',

    requireAuth,

    (req, res) => {

        if (req.session.user.role !== 'PATIENT') {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patient = db.prepare(`
            SELECT
                id,
                psychologist_id

            FROM patients

            WHERE user_id = ?
        `).get(
            req.session.user.id
        );


        if (!patient) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const payments = db.prepare(`
            SELECT
                sessions.id,
                sessions.scheduled_at,
                sessions.status,
                sessions.price,
                sessions.payment_status,
                sessions.payment_date,

                users.name AS psychologist_name,

                strftime(
                    '%d/%m/%Y',
                    sessions.scheduled_at
                ) AS date_formatted,

                strftime(
                    '%H:%M',
                    sessions.scheduled_at
                ) AS time_formatted

            FROM sessions

            INNER JOIN users
                ON users.id =
                sessions.psychologist_id

            WHERE sessions.patient_id = ?

            ORDER BY
                datetime(
                    sessions.scheduled_at
                ) DESC
        `).all(
            patient.id
        );


        return res.render(
            'patient-payments',
            {
                user: req.session.user,
                payments
            }
        );
    }
);

// ======================================================
// DIÁRIO EMOCIONAL
// ======================================================

app.get(
    '/my-diary',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patient =
            db.prepare(`
                SELECT
                    id

                FROM patients

                WHERE
                    user_id = ?
            `).get(
                req.session.user.id
            );


        if (
            !patient
        ) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const entries =
            db.prepare(`
                SELECT
                    id,
                    content,
                    mood_level,

                    strftime(
                        '%d/%m/%Y %H:%M',
                        created_at,
                        'localtime'
                    )
                        AS created_at_formatted

                FROM diary_entries

                WHERE
                    patient_id = ?

                ORDER BY
                    created_at DESC
            `).all(
                patient.id
            );


        return res.render(
            'my-diary',
            {
                user:
                    req.session.user,

                entries,

                error: null
            }
        );
    }
);


app.post(
    '/my-diary',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const {
            content,
            mood_level
        } = req.body;


        const patient =
            db.prepare(`
                SELECT
                    id

                FROM patients

                WHERE
                    user_id = ?
            `).get(
                req.session.user.id
            );


        if (
            !patient
        ) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        if (
            !content ||
            !content.trim()
        ) {

            const entries =
                db.prepare(`
                    SELECT
                        id,
                        content,
                        mood_level,

                        strftime(
                            '%d/%m/%Y %H:%M',
                            created_at,
                            'localtime'
                        )
                            AS created_at_formatted

                    FROM diary_entries

                    WHERE
                        patient_id = ?

                    ORDER BY
                        created_at DESC
                `).all(
                    patient.id
                );


            return res.render(
                'my-diary',
                {
                    user:
                        req.session.user,

                    entries,

                    error:
                        'Escreva algo antes de salvar o registro.'
                }
            );
        }


        let mood = null;


        if (
            mood_level
        ) {

            const parsedMood =
                Number(
                    mood_level
                );


            if (
                Number.isInteger(
                    parsedMood
                ) &&
                parsedMood >= 1 &&
                parsedMood <= 5
            ) {

                mood =
                    parsedMood;
            }
        }


        db.prepare(`
            INSERT INTO diary_entries (
                patient_id,
                content,
                mood_level
            )

            VALUES (?, ?, ?)
        `).run(
            patient.id,
            content.trim(),
            mood
        );


        return res.redirect(
            '/my-diary'
        );
    }
);


// ======================================================
// CONTATO PRIORITÁRIO - PACIENTE
// ======================================================

app.get(
    '/support-request',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patient =
            db.prepare(`
                SELECT
                    id,
                    psychologist_id

                FROM patients

                WHERE
                    user_id = ?
            `).get(
                req.session.user.id
            );


        if (
            !patient
        ) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const pendingRequest =
            db.prepare(`
                SELECT
                    id,

                    strftime(
                        '%d/%m/%Y %H:%M',
                        created_at,
                        'localtime'
                    )
                        AS created_at_formatted

                FROM support_requests

                WHERE
                    patient_id = ?

                AND
                    status IN (
                        'PENDING',
                        'VIEWED'
                    )

                ORDER BY
                    created_at DESC

                LIMIT 1
            `).get(
                patient.id
            );


        return res.render(
            'support-request',
            {
                user:
                    req.session.user,

                pendingRequest,

                message: null
            }
        );
    }
);


app.post(
    '/support-request',

    requireAuth,

   async (req, res) => {

        if (
            req.session.user.role !==
            'PATIENT'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const patient =
            db.prepare(`
                SELECT
                    id,
                    psychologist_id

                FROM patients

                WHERE
                    user_id = ?
            `).get(
                req.session.user.id
            );


        if (
            !patient
        ) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const existingRequest =
            db.prepare(`
                SELECT
                    id

                FROM support_requests

                WHERE
                    patient_id = ?

                AND
                    status IN (
                        'PENDING',
                        'VIEWED'
                    )

                LIMIT 1
            `).get(
                patient.id
            );


        if (
            existingRequest
        ) {

            return res.redirect(
                '/support-request'
            );
        }


        db.prepare(`
            INSERT INTO support_requests (
                patient_id,
                psychologist_id,
                status
            )

            VALUES (?, ?, ?)
        `).run(
            patient.id,
            patient.psychologist_id,
            'PENDING'
        );

        await sendPriorityNotification(
    patient.psychologist_id
);

        return res.redirect(
            '/support-request'
        );
    }
);


// ======================================================
// SOLICITAÇÕES PRIORITÁRIAS - PSICÓLOGA
// ======================================================


// MARCAR COMO VISUALIZADA

app.post(
    '/support-requests/:id/viewed',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão.'
                );
        }


        const requestId =
            Number(
                req.params.id
            );


        if (
            !Number.isInteger(
                requestId
            )
        ) {

            return res
                .status(400)
                .send(
                    'Solicitação inválida.'
                );
        }


        db.prepare(`
            UPDATE support_requests

            SET
                status = 'VIEWED',

                viewed_at =
                    CURRENT_TIMESTAMP

            WHERE
                id = ?

            AND
                psychologist_id = ?

            AND
                status = 'PENDING'
        `).run(
            requestId,
            req.session.user.id
        );


        return res.redirect(
            req.get('referer') ||
            '/dashboard'
        );
    }
);


// LISTAR SOLICITAÇÕES

app.get(
    '/support-requests',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const requests =
            db.prepare(`
                SELECT
                    support_requests.id,
                    support_requests.patient_id,
                    support_requests.status,

                    users.name
                        AS patient_name,

                    strftime(
                        '%d/%m/%Y %H:%M',
                        support_requests.created_at,
                        'localtime'
                    )
                        AS created_at_formatted

                FROM support_requests

                INNER JOIN patients
                    ON patients.id =
                    support_requests.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    support_requests.psychologist_id
                    = ?

                ORDER BY

                    CASE
                        support_requests.status

                        WHEN 'PENDING'
                            THEN 1

                        WHEN 'VIEWED'
                            THEN 2

                        WHEN 'RESOLVED'
                            THEN 3
                    END,

                    support_requests.created_at
                    DESC
            `).all(
                req.session.user.id
            );


        return res.render(
            'support-requests',
            {
                user:
                    req.session.user,

                requests
            }
        );
    }
);


// ALTERAR STATUS

app.post(
    '/support-requests/:id/status',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const requestId =
            Number(
                req.params.id
            );


        const {
            status
        } = req.body;


        const allowedStatuses = [
            'PENDING',
            'VIEWED',
            'RESOLVED'
        ];


        if (
            !Number.isInteger(
                requestId
            ) ||
            !allowedStatuses.includes(
                status
            )
        ) {

            return res
                .status(400)
                .send(
                    'Dados da solicitação inválidos.'
                );
        }


        const supportRequest =
            db.prepare(`
                SELECT
                    id

                FROM support_requests

                WHERE
                    id = ?

                AND
                    psychologist_id = ?
            `).get(
                requestId,
                req.session.user.id
            );


        if (
            !supportRequest
        ) {

            return res
                .status(404)
                .send(
                    'Solicitação não encontrada.'
                );
        }


        if (
            status ===
            'PENDING'
        ) {

            db.prepare(`
                UPDATE support_requests

                SET
                    status = 'PENDING',
                    viewed_at = NULL,
                    resolved_at = NULL

                WHERE
                    id = ?

                AND
                    psychologist_id = ?
            `).run(
                requestId,
                req.session.user.id
            );
        }


        if (
            status ===
            'VIEWED'
        ) {

            db.prepare(`
                UPDATE support_requests

                SET
                    status = 'VIEWED',

                    viewed_at =
                        COALESCE(
                            viewed_at,
                            CURRENT_TIMESTAMP
                        ),

                    resolved_at = NULL

                WHERE
                    id = ?

                AND
                    psychologist_id = ?
            `).run(
                requestId,
                req.session.user.id
            );
        }


        if (
            status ===
            'RESOLVED'
        ) {

            db.prepare(`
                UPDATE support_requests

                SET
                    status = 'RESOLVED',

                    viewed_at =
                        COALESCE(
                            viewed_at,
                            CURRENT_TIMESTAMP
                        ),

                    resolved_at =
                        CURRENT_TIMESTAMP

                WHERE
                    id = ?

                AND
                    psychologist_id = ?
            `).run(
                requestId,
                req.session.user.id
            );
        }


        return res.redirect(
            '/support-requests'
        );
    }
);


// ======================================================
// PACIENTES
// ======================================================


// LISTAR PACIENTES

app.get(
    '/patients',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patients =
            db.prepare(`
                SELECT
                    patients.id,
                    users.name,
                    users.email,
                    patients.phone,
                    patients.status

                FROM patients

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    patients.psychologist_id
                    = ?

                ORDER BY
                    users.name ASC
            `).all(
                req.session.user.id
            );


        return res.render(
            'patients',
            {
                user:
                    req.session.user,

                patients
            }
        );
    }
);


// ======================================================
// NOVO PACIENTE
// ======================================================

app.get(
    '/patients/new',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        return res.render(
            'new-patient',
            {
                user:
                    req.session.user,

                error: null
            }
        );
    }
);


registerPatientInvitationRoutes({
    app,
    db,
    requireAuth,
    bcrypt
});

// ======================================================
// FICHA DO PACIENTE
// ======================================================

app.get(
    '/patients/:id',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patientId =
            Number(
                req.params.id
            );


        if (
            !Number.isInteger(
                patientId
            )
        ) {

            return res
                .status(400)
                .send(
                    'Paciente inválido.'
                );
        }


        const patient =
            db.prepare(`
                SELECT
                    patients.id,
                    patients.phone,
                    patients.birth_date,
                    patients.status,
                    patients.default_session_price,

                    users.name,
                    users.email

                FROM patients

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    patients.id = ?

                AND
                    patients.psychologist_id
                    = ?
            `).get(
                patientId,
                req.session.user.id
            );


        if (
            !patient
        ) {

            return res
                .status(404)
                .send(
                    'Paciente não encontrado.'
                );
        }


        const lastSession =
            db.prepare(`
                SELECT
                    id,
                    scheduled_at,

                    strftime(
                        '%d/%m/%Y',
                        scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                WHERE
                    patient_id = ?

                AND
                    psychologist_id = ?

                AND
                    status =
                    'COMPLETED'

                AND
                    datetime(
                        scheduled_at
                    ) <=
                    datetime(
                        'now',
                        'localtime'
                    )

                ORDER BY
                    datetime(
                        scheduled_at
                    ) DESC

                LIMIT 1
            `).get(
                patientId,
                req.session.user.id
            );


        const nextSession =
            db.prepare(`
                SELECT
                    id,
                    scheduled_at,
                    status,

                    strftime(
                        '%d/%m/%Y',
                        scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                WHERE
                    patient_id = ?

                AND
                    psychologist_id = ?

                AND
                    datetime(
                        scheduled_at
                    ) >=
                    datetime(
                        'now',
                        'localtime'
                    )

                AND
                    status IN (
                        'SCHEDULED',
                        'CONFIRMED'
                    )

                ORDER BY
                    datetime(
                        scheduled_at
                    ) ASC

                LIMIT 1
            `).get(
                patientId,
                req.session.user.id
            );


        const sessionHistory =
            db.prepare(`
                SELECT
                    id,
                    scheduled_at,
                    status,
                    price,
                    payment_status,

                    strftime(
                        '%d/%m/%Y',
                        scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                WHERE
                    patient_id = ?

                AND
                    psychologist_id = ?

                ORDER BY
                    datetime(
                        scheduled_at
                    ) DESC
            `).all(
                patientId,
                req.session.user.id
            );


        let diaryEntries;


        if (
            lastSession
        ) {

            diaryEntries =
                db.prepare(`
                    SELECT
                        id,
                        content,
                        mood_level,

                        strftime(
                            '%d/%m/%Y %H:%M',
                            created_at,
                            'localtime'
                        )
                            AS created_at_formatted

                    FROM diary_entries

                    WHERE
                        patient_id = ?

                    AND
                        datetime(
                            created_at
                        ) >
                        datetime(?)

                    ORDER BY
                        datetime(
                            created_at
                        ) DESC
                `).all(
                    patientId,
                    lastSession
                        .scheduled_at
                );


        } else {

            diaryEntries =
                db.prepare(`
                    SELECT
                        id,
                        content,
                        mood_level,

                        strftime(
                            '%d/%m/%Y %H:%M',
                            created_at,
                            'localtime'
                        )
                            AS created_at_formatted

                    FROM diary_entries

                    WHERE
                        patient_id = ?

                    ORDER BY
                        datetime(
                            created_at
                        ) DESC
                `).all(
                    patientId
                );
        }


        const pendingPayments =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(price),
                        0
                    )
                        AS total

                FROM sessions

                WHERE
                    patient_id = ?

                AND
                    psychologist_id = ?

                AND
                    payment_status =
                    'PENDING'

                AND
                    status !=
                    'CANCELED'
            `).get(
                patientId,
                req.session.user.id
            );


        return res.render(
            'patient-details',
            {
                user:
                    req.session.user,

                patient,

                diaryEntries,

                lastSession,

                nextSession,

                sessionHistory,

                pendingPayments
            }
        );
    }
);

// ======================================================
// DISPONIBILIDADE DA PSICÓLOGA
// ======================================================


// LISTAR HORÁRIOS

app.get(
    '/availability',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const slots =
            db.prepare(`
                SELECT
                    id,
                    starts_at,
                    status,

                    strftime(
                        '%d/%m/%Y',
                        starts_at
                    ) AS date_formatted,

                    strftime(
                        '%H:%M',
                        starts_at
                    ) AS time_formatted

                FROM availability_slots

                WHERE psychologist_id = ?

                ORDER BY
                    datetime(starts_at) ASC
            `).all(
                req.session.user.id
            );


        return res.render(
            'availability',
            {
                user:
                    req.session.user,

                slots,

                error: null
            }
        );
    }
);


// CRIAR NOVO HORÁRIO

app.post(
    '/availability/new',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const {
            starts_at
        } = req.body;


        const slots =
            db.prepare(`
                SELECT
                    id,
                    starts_at,
                    status,

                    strftime(
                        '%d/%m/%Y',
                        starts_at
                    ) AS date_formatted,

                    strftime(
                        '%H:%M',
                        starts_at
                    ) AS time_formatted

                FROM availability_slots

                WHERE psychologist_id = ?

                ORDER BY
                    datetime(starts_at) ASC
            `).all(
                req.session.user.id
            );


        if (!starts_at) {

            return res.render(
                'availability',
                {
                    user:
                        req.session.user,

                    slots,

                    error:
                        'Informe a data e o horário.'
                }
            );
        }


        const selectedDate =
            new Date(starts_at);


        if (
            Number.isNaN(
                selectedDate.getTime()
            ) ||
            selectedDate <= new Date()
        ) {

            return res.render(
                'availability',
                {
                    user:
                        req.session.user,

                    slots,

                    error:
                        'Escolha uma data e horário futuros.'
                }
            );
        }


        const normalizedStartsAt =
            String(starts_at)
                .replace(
                    'T',
                    ' '
                )
                .slice(
                    0,
                    16
                )
            +
            ':00';


        try {

            db.prepare(`
                INSERT INTO availability_slots (
                    psychologist_id,
                    starts_at,
                    status
                )

                VALUES (?, ?, 'OPEN')
            `).run(
                req.session.user.id,
                normalizedStartsAt
            );


        } catch (error) {

            return res.render(
                'availability',
                {
                    user:
                        req.session.user,

                    slots,

                    error:
                        'Esse horário já foi disponibilizado.'
                }
            );
        }


        return res.redirect(
            '/availability'
        );
    }
);

// ======================================================
// EDITAR HORÁRIO DISPONÍVEL
// ======================================================

app.get(
    '/availability/:id/edit',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const slotId =
            Number(req.params.id);


        if (
            !Number.isInteger(slotId)
        ) {

            return res
                .status(400)
                .send(
                    'Horário inválido.'
                );
        }


        const slot =
            db.prepare(`
                SELECT
                    id,
                    starts_at,
                    status,

                    strftime(
                        '%Y-%m-%dT%H:%M',
                        starts_at
                    ) AS input_value

                FROM availability_slots

                WHERE id = ?

                AND psychologist_id = ?

                AND status = 'OPEN'
            `).get(
                slotId,
                req.session.user.id
            );


        if (!slot) {

            return res
                .status(404)
                .send(
                    'Horário disponível não encontrado.'
                );
        }


        return res.render(
            'edit-availability',
            {
                user:
                    req.session.user,

                slot,

                error: null
            }
        );
    }
);


// SALVAR ALTERAÇÃO

app.post(
    '/availability/:id/edit',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const slotId =
            Number(req.params.id);

        const {
            starts_at
        } = req.body;


        const slot =
            db.prepare(`
                SELECT
                    id,
                    status,

                    strftime(
                        '%Y-%m-%dT%H:%M',
                        starts_at
                    ) AS input_value

                FROM availability_slots

                WHERE id = ?

                AND psychologist_id = ?

                AND status = 'OPEN'
            `).get(
                slotId,
                req.session.user.id
            );


        if (!slot) {

            return res
                .status(404)
                .send(
                    'Horário disponível não encontrado.'
                );
        }


        if (!starts_at) {

            return res.render(
                'edit-availability',
                {
                    user:
                        req.session.user,

                    slot,

                    error:
                        'Informe a nova data e horário.'
                }
            );
        }


        const selectedDate =
            new Date(starts_at);


        if (
            Number.isNaN(
                selectedDate.getTime()
            ) ||
            selectedDate <= new Date()
        ) {

            return res.render(
                'edit-availability',
                {
                    user:
                        req.session.user,

                    slot,

                    error:
                        'Escolha uma data e horário futuros.'
                }
            );
        }


        const normalizedStartsAt =
            String(starts_at)
                .replace('T', ' ')
                .slice(0, 16)
            +
            ':00';


        try {

            db.prepare(`
                UPDATE availability_slots

                SET
                    starts_at = ?,
                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE id = ?

                AND psychologist_id = ?

                AND status = 'OPEN'
            `).run(
                normalizedStartsAt,
                slotId,
                req.session.user.id
            );


        } catch (error) {

            return res.render(
                'edit-availability',
                {
                    user:
                        req.session.user,

                    slot,

                    error:
                        'Já existe outro horário disponível nessa data e hora.'
                }
            );
        }


        return res.redirect(
            '/availability'
        );
    }
);


// ======================================================
// CANCELAR HORÁRIO DISPONÍVEL
// ======================================================

app.post(
    '/availability/:id/cancel',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const slotId =
            Number(req.params.id);


        if (
            !Number.isInteger(slotId)
        ) {

            return res
                .status(400)
                .send(
                    'Horário inválido.'
                );
        }


        db.prepare(`
            UPDATE availability_slots

            SET
                status = 'CANCELED',
                updated_at =
                    CURRENT_TIMESTAMP

            WHERE id = ?

            AND psychologist_id = ?

            AND status = 'OPEN'
        `).run(
            slotId,
            req.session.user.id
        );


        return res.redirect(
            '/availability'
        );
    }
);

// ======================================================
// AGENDAMENTO PELO PACIENTE
// ======================================================


// VER HORÁRIOS DISPONÍVEIS

app.get(
    '/patient/book-session',

    requireAuth,

    (req, res) => {

        if (req.session.user.role !== 'PATIENT') {
            return res
                .status(403)
                .send('Você não possui permissão para acessar esta página.');
        }


        const patient = db.prepare(`
            SELECT
                id,
                psychologist_id,
                default_session_price

            FROM patients

            WHERE user_id = ?
        `).get(req.session.user.id);


        if (!patient) {
            return res
                .status(404)
                .send('Paciente não encontrado.');
        }


        const slots = db.prepare(`
            SELECT
                id,
                starts_at,

                strftime(
                    '%d/%m/%Y',
                    starts_at
                ) AS date_formatted,

                strftime(
                    '%H:%M',
                    starts_at
                ) AS time_formatted

            FROM availability_slots

            WHERE psychologist_id = ?

            AND status = 'OPEN'

            AND datetime(starts_at) >
                datetime('now', 'localtime')

            ORDER BY datetime(starts_at) ASC
        `).all(patient.psychologist_id);


        return res.render(
            'patient-book-session',
            {
                user: req.session.user,
                slots,
                error: null
            }
        );
    }
);


// RESERVAR HORÁRIO

app.post(
    '/patient/book-session/:slotId',

    requireAuth,

    (req, res) => {

        if (req.session.user.role !== 'PATIENT') {
            return res
                .status(403)
                .send('Você não possui permissão para realizar esta ação.');
        }


        const slotId = Number(req.params.slotId);


        if (!Number.isInteger(slotId)) {
            return res
                .status(400)
                .send('Horário inválido.');
        }


        const bookSession = db.transaction(() => {

            const patient = db.prepare(`
                SELECT
                    id,
                    psychologist_id,
                    default_session_price

                FROM patients

                WHERE user_id = ?
            `).get(req.session.user.id);


            if (!patient) {
                throw new Error('PATIENT_NOT_FOUND');
            }


            const slot = db.prepare(`
                SELECT
                    id,
                    psychologist_id,
                    starts_at,
                    status

                FROM availability_slots

                WHERE id = ?

                AND psychologist_id = ?

                AND status = 'OPEN'
            `).get(
                slotId,
                patient.psychologist_id
            );


            if (!slot) {
                throw new Error('SLOT_UNAVAILABLE');
            }


            if (
                new Date(slot.starts_at) <=
                new Date()
            ) {
                throw new Error('SLOT_UNAVAILABLE');
            }


            const updateSlot = db.prepare(`
                UPDATE availability_slots

                SET
                    status = 'BOOKED',
                    updated_at = CURRENT_TIMESTAMP

                WHERE id = ?

                AND status = 'OPEN'
            `).run(slot.id);


            if (updateSlot.changes === 0) {
                throw new Error('SLOT_UNAVAILABLE');
            }


            db.prepare(`
                INSERT INTO sessions (
                    patient_id,
                    psychologist_id,
                    scheduled_at,
                    status,
                    price,
                    payment_status
                )

                VALUES (
                    ?,
                    ?,
                    ?,
                    'SCHEDULED',
                    ?,
                    'PENDING'
                )
            `).run(
                patient.id,
                patient.psychologist_id,
                slot.starts_at,
                patient.default_session_price || 0
            );
        });


        try {

            bookSession();

        } catch (error) {

            if (error.message === 'SLOT_UNAVAILABLE') {
                return res
                    .status(409)
                    .send(
                        'Esse horário não está mais disponível. Volte e escolha outro horário.'
                    );
            }

            console.error(error);

            return res
                .status(500)
                .send(
                    'Não foi possível realizar o agendamento.'
                );
        }


        return res.redirect(
            '/patient/sessions'
        );
    }
);

// ======================================================
// FINANCEIRO - PSICÓLOGA
// ======================================================

app.get(
    '/finance',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !== 'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const psychologistId =
            req.session.user.id;


        // RECEBIDO NO MÊS

        const receivedMonth =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(price),
                        0
                    ) AS total

                FROM sessions

                WHERE psychologist_id = ?

                AND payment_status = 'PAID'

                AND strftime(
                    '%Y-%m',
                    payment_date,
                    'localtime'
                ) =
                strftime(
                    '%Y-%m',
                    'now',
                    'localtime'
                )
            `).get(
                psychologistId
            );


        // TOTAL A RECEBER

        const pendingAmount =
            db.prepare(`
                SELECT
                    COALESCE(
                        SUM(price),
                        0
                    ) AS total

                FROM sessions

                WHERE psychologist_id = ?

                AND payment_status = 'PENDING'

                AND status != 'CANCELED'
            `).get(
                psychologistId
            );


        // PAGAMENTOS RECEBIDOS NO MÊS

        const paidCount =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM sessions

                WHERE psychologist_id = ?

                AND payment_status = 'PAID'

                AND strftime(
                    '%Y-%m',
                    payment_date,
                    'localtime'
                ) =
                strftime(
                    '%Y-%m',
                    'now',
                    'localtime'
                )
            `).get(
                psychologistId
            );


        // PAGAMENTOS PENDENTES

        const pendingCount =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM sessions

                WHERE psychologist_id = ?

                AND payment_status = 'PENDING'

                AND status != 'CANCELED'
            `).get(
                psychologistId
            );


        // HISTÓRICO FINANCEIRO

        const transactions =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.price,
                    sessions.payment_status,
                    sessions.payment_method,
                    sessions.payment_installments,
                    sessions.scheduled_at,
                    sessions.payment_date,

                    users.name
                        AS patient_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    )
                        AS session_date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                        AS session_time_formatted,

                    CASE

                        WHEN
                            sessions.payment_date IS NOT NULL

                        THEN
                            strftime(
                                '%d/%m/%Y',
                                sessions.payment_date,
                                'localtime'
                            )

                        ELSE NULL

                    END
                        AS payment_date_formatted

                FROM sessions

                INNER JOIN patients
                    ON patients.id =
                    sessions.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    sessions.psychologist_id = ?

                AND sessions.status != 'CANCELED'

                ORDER BY

                    CASE
                        WHEN sessions.payment_date IS NOT NULL
                        THEN datetime(sessions.payment_date)
                        ELSE datetime(sessions.scheduled_at)
                    END DESC
            `).all(
                psychologistId
            );


        return res.render(
            'finance',
            {
                user:
                    req.session.user,

                receivedMonth:
                    receivedMonth.total,

                pendingAmount:
                    pendingAmount.total,

                paidCount:
                    paidCount.total,

                pendingCount:
                    pendingCount.total,

                transactions
            }
        );
    }
);

// ======================================================
// RELATÓRIOS - PSICÓLOGA
// ======================================================

app.get(
    '/reports',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !== 'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const psychologistId =
            req.session.user.id;


        // ==================================================
        // PACIENTES ATIVOS
        // ==================================================

        const activePatients =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM patients

                WHERE psychologist_id = ?

                AND status = 'ACTIVE'
            `).get(
                psychologistId
            );


        // ==================================================
        // RESUMO DAS SESSÕES
        // ==================================================

        const sessionStats =
            db.prepare(`
                SELECT

                    COUNT(*) AS total,

                    SUM(
                        CASE
                            WHEN status = 'COMPLETED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS completed,

                    SUM(
                        CASE
                            WHEN status = 'SCHEDULED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS scheduled,

                    SUM(
                        CASE
                            WHEN status = 'CONFIRMED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS confirmed,

                    SUM(
                        CASE
                            WHEN status = 'CANCELED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS canceled,

                    SUM(
                        CASE
                            WHEN status = 'NO_SHOW'
                            THEN 1
                            ELSE 0
                        END
                    ) AS noShow

                FROM sessions

                WHERE psychologist_id = ?
            `).get(
                psychologistId
            );


        // ==================================================
        // RESUMO FINANCEIRO
        // ==================================================

        const financialStats =
            db.prepare(`
                SELECT

                    COALESCE(
                        SUM(
                            CASE
                                WHEN payment_status = 'PAID'
                                THEN price
                                ELSE 0
                            END
                        ),
                        0
                    ) AS received,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN
                                    payment_status = 'PENDING'
                                    AND status != 'CANCELED'
                                THEN price
                                ELSE 0
                            END
                        ),
                        0
                    ) AS pending

                FROM sessions

                WHERE psychologist_id = ?
            `).get(
                psychologistId
            );


        // ==================================================
        // ÚLTIMOS MESES
        // ==================================================

        const monthlyReport =
            db.prepare(`
                SELECT

                    strftime(
                        '%Y-%m',
                        scheduled_at
                    ) AS month,

                    COUNT(*) AS total_sessions,

                    SUM(
                        CASE
                            WHEN status = 'COMPLETED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS completed,

                    SUM(
                        CASE
                            WHEN status = 'CANCELED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS canceled,

                    SUM(
                        CASE
                            WHEN status = 'NO_SHOW'
                            THEN 1
                            ELSE 0
                        END
                    ) AS no_show,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN payment_status = 'PAID'
                                THEN price
                                ELSE 0
                            END
                        ),
                        0
                    ) AS received

                FROM sessions

                WHERE psychologist_id = ?

                GROUP BY
                    strftime(
                        '%Y-%m',
                        scheduled_at
                    )

                ORDER BY month DESC

                LIMIT 6
            `).all(
                psychologistId
            );


        // ==================================================
        // RELATÓRIO POR PACIENTE
        // ==================================================

        const patientReport =
            db.prepare(`
                SELECT

                    patients.id,

                    users.name
                        AS patient_name,

                    patients.status
                        AS patient_status,

                    COUNT(sessions.id)
                        AS total_sessions,

                    SUM(
                        CASE
                            WHEN sessions.status = 'COMPLETED'
                            THEN 1
                            ELSE 0
                        END
                    ) AS completed_sessions,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN
                                    sessions.payment_status = 'PENDING'
                                    AND sessions.status != 'CANCELED'
                                THEN sessions.price
                                ELSE 0
                            END
                        ),
                        0
                    ) AS pending_amount

                FROM patients

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                LEFT JOIN sessions
                    ON sessions.patient_id =
                    patients.id

                WHERE
                    patients.psychologist_id = ?

                GROUP BY
                    patients.id,
                    users.name,
                    patients.status

                ORDER BY
                    users.name ASC
            `).all(
                psychologistId
            );


        return res.render(
            'reports',
            {
                user:
                    req.session.user,

                activePatients:
                    activePatients.total || 0,

                sessionStats,

                financialStats,

                monthlyReport,

                patientReport
            }
        );
    }
);

// ======================================================
// AGENDA E SESSÕES
// ======================================================


// LISTAR SESSÕES

app.get(
    '/sessions',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const sessions =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.scheduled_at,
                    sessions.status,
                    sessions.price,
                    sessions.payment_status,

                    users.name
                        AS patient_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                INNER JOIN patients
                    ON patients.id =
                    sessions.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    sessions.psychologist_id
                    = ?

                ORDER BY
                    datetime(
                        sessions.scheduled_at
                    ) ASC
            `).all(
                req.session.user.id
            );


        return res.render(
            'agenda',
            {
                user:
                    req.session.user,

                sessions
            }
        );
    }
);


// ======================================================
// NOVA SESSÃO
// ======================================================

app.get(
    '/sessions/new',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const patients =
            db.prepare(`
                SELECT
                    patients.id,
                    users.name

                FROM patients

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    patients.psychologist_id
                    = ?

                AND
                    patients.status =
                    'ACTIVE'

                ORDER BY
                    users.name ASC
            `).all(
                req.session.user.id
            );


             res.render(
            'new-session',
            {
                user: req.session.user,
                patients,
                error: null
            }
        );
    }
);

app.post(
    '/sessions/new',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const {
            patient_id,
            scheduled_at,
            price
        } = req.body;


        const patients =
            db.prepare(`
                SELECT
                    patients.id,
                    patients.default_session_price,
                    users.name

                FROM patients

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    patients.psychologist_id
                    = ?

                AND
                    patients.status =
                    'ACTIVE'

                ORDER BY
                    users.name ASC
            `).all(
                req.session.user.id
            );


        if (
            !patient_id ||
            !scheduled_at
        ) {

            return res.render(
                'new-session',
                {
                    user:
                        req.session.user,

                    patients,

                    error:
                        'Paciente, data e horário são obrigatórios.'
                }
            );
        }


        const patient =
            db.prepare(`
                SELECT
                    id,
                    default_session_price

                FROM patients

                WHERE
                    id = ?

                AND
                    psychologist_id = ?

                AND
                    status =
                    'ACTIVE'
            `).get(
                Number(
                    patient_id
                ),

                req.session.user.id
            );


        if (
            !patient
        ) {

            return res.render(
                'new-session',
                {
                    user:
                        req.session.user,

                    patients,

                    error:
                        'Paciente inválido.'
                }
            );
        }


        let sessionPrice;


        if (
            price !== ''
        ) {

            sessionPrice =
                Number(
                    price
                );

        } else {

            sessionPrice =
                Number(
                    patient
                        .default_session_price
                ) || 0;
        }


        if (
            Number.isNaN(
                sessionPrice
            ) ||
            sessionPrice < 0
        ) {

            return res.render(
                'new-session',
                {
                    user:
                        req.session.user,

                    patients,

                    error:
                        'Informe um valor válido para a sessão.'
                }
            );
        }


        const normalizedScheduledAt =
            String(
                scheduled_at
            )
                .replace(
                    'T',
                    ' '
                )
                .slice(
                    0,
                    16
                )
            +
            ':00';


        db.prepare(`
            INSERT INTO sessions (
                patient_id,
                psychologist_id,
                scheduled_at,
                status,
                price,
                payment_status
            )

            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?
            )
        `).run(
            patient.id,

            req.session.user.id,

            normalizedScheduledAt,

            'SCHEDULED',

            sessionPrice,

            'PENDING'
        );


        return res.redirect(
            '/sessions'
        );
    }
);


// ======================================================
// VISUALIZAR SESSÃO
// ======================================================

app.get(
    '/sessions/:id',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const sessionId =
            Number(
                req.params.id
            );


        if (
            !Number.isInteger(
                sessionId
            )
        ) {

            return res
                .status(400)
                .send(
                    'Sessão inválida.'
                );
        }


        const sessionItem =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.patient_id,
                    sessions.scheduled_at,
                    sessions.status,
                    sessions.price,
                    sessions.payment_status,
                    sessions.payment_date,

                    users.name
                        AS patient_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    )
                        AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                        AS time_formatted

                FROM sessions

                INNER JOIN patients
                    ON patients.id =
                    sessions.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    sessions.id = ?

                AND
                    sessions.psychologist_id
                    = ?
            `).get(
                sessionId,
                req.session.user.id
            );


        if (
            !sessionItem
        ) {

            return res
                .status(404)
                .send(
                    'Sessão não encontrada.'
                );
        }


        const clinicalNote =
            db.prepare(`
                SELECT
                    id,
                    content

                FROM clinical_notes

                WHERE
                    session_id = ?

                AND
                    psychologist_id = ?
            `).get(
                sessionId,
                req.session.user.id
            );


        return res.render(
            'session-details',
            {
                user:
                    req.session.user,

                sessionItem,

                clinicalNote
            }
        );
    }
);


// ======================================================
// ATUALIZAR SESSÃO
// ======================================================

app.post(
    '/sessions/:id/update',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para realizar esta ação.'
                );
        }


        const sessionId =
            Number(
                req.params.id
            );


        const {
            status,
            payment_status,
            clinical_note
        } = req.body;


        const allowedStatuses = [
            'SCHEDULED',
            'CONFIRMED',
            'COMPLETED',
            'CANCELED',
            'NO_SHOW'
        ];


        const allowedPaymentStatuses = [
            'PENDING',
            'PAID'
        ];


        if (
            !Number.isInteger(
                sessionId
            ) ||
            !allowedStatuses.includes(
                status
            )
        ) {

            return res
                .status(400)
                .send(
                    'Status de sessão inválido.'
                );
        }


        if (
            !allowedPaymentStatuses.includes(
                payment_status
            )
        ) {

            return res
                .status(400)
                .send(
                    'Status de pagamento inválido.'
                );
        }


        const sessionItem =
            db.prepare(`
                SELECT
                    id,
                    payment_status,
                    payment_date

                FROM sessions

                WHERE
                    id = ?

                AND
                    psychologist_id = ?
            `).get(
                sessionId,
                req.session.user.id
            );


        if (
            !sessionItem
        ) {

            return res
                .status(404)
                .send(
                    'Sessão não encontrada.'
                );
        }


        const updateSession =
            db.transaction(
                () => {

                    let paymentDate =
                        sessionItem
                            .payment_date ||
                        null;


                    if (
                        payment_status ===
                            'PAID' &&
                        sessionItem
                            .payment_status !==
                            'PAID'
                    ) {

                        paymentDate =
                            new Date()
                                .toISOString()
                                .slice(
                                    0,
                                    19
                                )
                                .replace(
                                    'T',
                                    ' '
                                );
                    }


                    if (
                        payment_status ===
                        'PENDING'
                    ) {

                        paymentDate =
                            null;
                    }


                    db.prepare(`
                        UPDATE sessions

                        SET
                            status = ?,
                            payment_status = ?,
                            payment_date = ?,

                            updated_at =
                                CURRENT_TIMESTAMP

                        WHERE
                            id = ?

                        AND
                            psychologist_id = ?
                    `).run(
                        status,
                        payment_status,
                        paymentDate,
                        sessionId,
                        req.session.user.id
                    );


                    const noteContent =
                        clinical_note

                            ? clinical_note
                                .trim()

                            : '';


                    const existingNote =
                        db.prepare(`
                            SELECT
                                id

                            FROM clinical_notes

                            WHERE
                                session_id = ?

                            AND
                                psychologist_id = ?
                        `).get(
                            sessionId,
                            req.session.user.id
                        );


                    if (
                        noteContent
                    ) {

                        if (
                            existingNote
                        ) {

                            db.prepare(`
                                UPDATE
                                    clinical_notes

                                SET
                                    content = ?,

                                    updated_at =
                                        CURRENT_TIMESTAMP

                                WHERE
                                    id = ?

                                AND
                                    psychologist_id
                                    = ?
                            `).run(
                                noteContent,

                                existingNote.id,

                                req.session.user.id
                            );


                        } else {

                            db.prepare(`
                                INSERT INTO
                                    clinical_notes (
                                        session_id,
                                        psychologist_id,
                                        content
                                    )

                                VALUES (
                                    ?,
                                    ?,
                                    ?
                                )
                            `).run(
                                sessionId,

                                req.session.user.id,

                                noteContent
                            );
                        }
                    }
                }
            );


        updateSession();


        return res.redirect(
            `/sessions/${sessionId}`
        );
    }
);

// ======================================================
// RELATÓRIOS - PSICÓLOGA
// ======================================================

app.get(
    '/reports',

    requireAuth,

    (req, res) => {

        if (
            req.session.user.role !==
            'PSYCHOLOGIST'
        ) {

            return res
                .status(403)
                .send(
                    'Você não possui permissão para acessar esta página.'
                );
        }


        const psychologistId =
            req.session.user.id;


        // SESSÕES

        const sessions =
            db.prepare(`
                SELECT
                    sessions.id,
                    sessions.status,
                    sessions.price,
                    sessions.payment_status,

                    users.name
                    AS patient_name,

                    strftime(
                        '%d/%m/%Y',
                        sessions.scheduled_at
                    )
                    AS date_formatted,

                    strftime(
                        '%H:%M',
                        sessions.scheduled_at
                    )
                    AS time_formatted

                FROM sessions

                INNER JOIN patients
                    ON patients.id =
                    sessions.patient_id

                INNER JOIN users
                    ON users.id =
                    patients.user_id

                WHERE
                    sessions.psychologist_id = ?

                ORDER BY
                    datetime(
                        sessions.scheduled_at
                    ) DESC
            `).all(
                psychologistId
            );


        // PACIENTES ATIVOS

        const activePatients =
            db.prepare(`
                SELECT
                    COUNT(*) AS total

                FROM patients

                WHERE
                    psychologist_id = ?

                AND status = 'ACTIVE'
            `).get(
                psychologistId
            );


        return res.render(
            'reports',
            {
                user:
                    req.session.user,

                sessions,

                activePatients:
                    activePatients.total
            }
        );
    }
);

// ======================================================
// LOGOUT
// ======================================================

app.get(
    '/logout',

    (req, res) => {

        req.session.destroy(
            () => {

                res.redirect(
                    '/login'
                );
            }
        );
    }
);


// ======================================================
// SERVIDOR
// ======================================================

app.listen(
    PORT,

    () => {

        console.log(
            `Servidor rodando em http://localhost:${PORT}`
        );
    }
);