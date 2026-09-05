const crypto = require('crypto');

module.exports = function registerPatientInvitationRoutes({
    app,
    db,
    requireAuth,
    bcrypt
}) {
    function hashToken(token) {
        return crypto
            .createHash('sha256')
            .update(String(token || ''))
            .digest('hex');
    }

    function getBaseUrl(req) {
        const configured = String(process.env.APP_BASE_URL || '')
            .trim()
            .replace(/\/+$/, '');

        if (configured) {
            return configured;
        }

        const host = req.get('host');
        const isLocal =
            host.startsWith('localhost') ||
            host.startsWith('127.0.0.1');

        return (isLocal ? 'http' : 'https') + '://' + host;
    }

    function findValidInvitation(token) {
        const sql = [
            'SELECT',
            '    pi.id,',
            '    pi.user_id,',
            '    pi.psychologist_id,',
            '    u.name,',
            '    u.email',
            'FROM patient_invitations pi',
            'INNER JOIN users u ON u.id = pi.user_id',
            'WHERE pi.token_hash = ?',
            '  AND pi.used_at IS NULL',
            "  AND datetime(pi.expires_at) > datetime('now')",
            "  AND u.role = 'PATIENT'",
            'LIMIT 1'
        ].join('\n');

        return db.prepare(sql).get(hashToken(token));
    }

    app.post('/patients/new', requireAuth, (req, res) => {
        if (req.session.user.role !== 'PSYCHOLOGIST') {
            return res.status(403).send(
                'Você não possui permissão para realizar esta ação.'
            );
        }

        const {
            name,
            email,
            phone,
            birth_date,
            default_session_price
        } = req.body;

        const cleanName = String(name || '').trim();
        const cleanEmail = String(email || '').trim().toLowerCase();

        if (!cleanName || !cleanEmail) {
            return res.render('new-patient', {
                user: req.session.user,
                error: 'Nome e e-mail são obrigatórios.'
            });
        }

        const existingUser = db.prepare(
            'SELECT id FROM users WHERE LOWER(email) = ?'
        ).get(cleanEmail);

        if (existingUser) {
            return res.render('new-patient', {
                user: req.session.user,
                error: 'Já existe um usuário cadastrado com esse e-mail.'
            });
        }

        const price =
            default_session_price === '' ||
            default_session_price === undefined
                ? 0
                : Number(default_session_price);

        if (Number.isNaN(price) || price < 0) {
            return res.render('new-patient', {
                user: req.session.user,
                error: 'Informe um valor de sessão válido.'
            });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const expiresAt = new Date(
            Date.now() + 24 * 60 * 60 * 1000
        )
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');

        try {
            const createPatient = db.transaction(() => {
                const temporaryPassword = crypto.randomBytes(48).toString('hex');
                const temporaryHash = bcrypt.hashSync(temporaryPassword, 12);

                const userResult = db.prepare([
                    'INSERT INTO users (',
                    '    name,',
                    '    email,',
                    '    password_hash,',
                    '    role',
                    ') VALUES (?, ?, ?, ?)'
                ].join('\n')).run(
                    cleanName,
                    cleanEmail,
                    temporaryHash,
                    'PATIENT'
                );

                const userId = Number(userResult.lastInsertRowid);

                db.prepare([
                    'INSERT INTO patients (',
                    '    user_id,',
                    '    psychologist_id,',
                    '    phone,',
                    '    birth_date,',
                    '    status,',
                    '    default_session_price',
                    ') VALUES (?, ?, ?, ?, ?, ?)'
                ].join('\n')).run(
                    userId,
                    req.session.user.id,
                    phone ? String(phone).trim() : null,
                    birth_date || null,
                    'INACTIVE',
                    price
                );

                db.prepare([
                    'INSERT INTO patient_invitations (',
                    '    user_id,',
                    '    psychologist_id,',
                    '    token_hash,',
                    '    expires_at',
                    ') VALUES (?, ?, ?, ?)'
                ].join('\n')).run(
                    userId,
                    req.session.user.id,
                    tokenHash,
                    expiresAt
                );
            });

            createPatient();

            const inviteUrl =
                getBaseUrl(req) + '/activate/' + token;

            return res.render('patient-invite-created', {
                user: req.session.user,
                patientName: cleanName,
                patientEmail: cleanEmail,
                inviteUrl,
                emailSent: false
            });
        } catch (error) {
            console.error('Erro ao cadastrar paciente:', error);

            return res.render('new-patient', {
                user: req.session.user,
                error: 'Não foi possível cadastrar o paciente.'
            });
        }
    });

    app.get('/activate/:token', (req, res) => {
        const token = String(req.params.token || '');
        const invitation = findValidInvitation(token);

        if (!invitation) {
            return res.render('patient-activate', {
                patientName: null,
                token: null,
                error: 'Este convite é inválido, já foi utilizado ou expirou.',
                success: false
            });
        }

        return res.render('patient-activate', {
            patientName: invitation.name,
            token,
            error: null,
            success: false
        });
    });

    app.post('/activate/:token', (req, res) => {
        const token = String(req.params.token || '');
        const password = String(req.body.password || '');
        const confirmation = String(
            req.body.password_confirmation || ''
        );
        const invitation = findValidInvitation(token);

        if (!invitation) {
            return res.render('patient-activate', {
                patientName: null,
                token: null,
                error: 'Este convite é inválido, já foi utilizado ou expirou.',
                success: false
            });
        }

        if (password.length < 8) {
            return res.render('patient-activate', {
                patientName: invitation.name,
                token,
                error: 'A senha deve possuir pelo menos 8 caracteres.',
                success: false
            });
        }

        if (password !== confirmation) {
            return res.render('patient-activate', {
                patientName: invitation.name,
                token,
                error: 'As senhas informadas não são iguais.',
                success: false
            });
        }

        try {
            const activatePatient = db.transaction(() => {
                const passwordHash = bcrypt.hashSync(password, 12);

                const userResult = db.prepare([
                    'UPDATE users',
                    'SET password_hash = ?,',
                    '    updated_at = CURRENT_TIMESTAMP',
                    'WHERE id = ?',
                    "  AND role = 'PATIENT'"
                ].join('\n')).run(
                    passwordHash,
                    invitation.user_id
                );

                const patientResult = db.prepare([
                    'UPDATE patients',
                    "SET status = 'ACTIVE',",
                    '    updated_at = CURRENT_TIMESTAMP',
                    'WHERE user_id = ?',
                    '  AND psychologist_id = ?'
                ].join('\n')).run(
                    invitation.user_id,
                    invitation.psychologist_id
                );

                const inviteResult = db.prepare([
                    'UPDATE patient_invitations',
                    'SET used_at = CURRENT_TIMESTAMP',
                    'WHERE id = ?',
                    '  AND used_at IS NULL'
                ].join('\n')).run(invitation.id);

                if (
                    userResult.changes !== 1 ||
                    patientResult.changes !== 1 ||
                    inviteResult.changes !== 1
                ) {
                    throw new Error('Falha ao ativar convite.');
                }
            });

            activatePatient();

            return res.render('patient-activate', {
                patientName: invitation.name,
                token: null,
                error: null,
                success: true
            });
        } catch (error) {
            console.error('Erro ao ativar paciente:', error);

            return res.render('patient-activate', {
                patientName: invitation.name,
                token,
                error: 'Não foi possível ativar seu acesso. Tente novamente.',
                success: false
            });
        }
    });
};
