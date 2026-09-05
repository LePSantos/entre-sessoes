const db = require('./db');
const bcrypt = require('bcryptjs');


// ======================================================
// DADOS FICTÍCIOS PARA DEMONSTRAÇÃO / TCC
// ======================================================

const psychologist = {
    name: 'Dra. Bruna Nascimento',

    email:
        'bruna.nascimento.psi@gmail.com',

    legacyEmail:
        'bruna@entresessoes.local',

    password:
        'Tcc@12345'
};


const patient = {
    name: 'João Maria',

    email:
        'joaomaria@hotmail.com',

    password:
        'Tcc@12345'
};


// ======================================================
// TRANSAÇÃO
// ======================================================

const seedDatabase =
    db.transaction(() => {


        // ==================================================
        // PSICÓLOGA
        // ==================================================

        let psychologistUser =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    role

                FROM users

                WHERE
                    LOWER(email) =
                    LOWER(?)

                AND role =
                    'PSYCHOLOGIST'

                LIMIT 1
            `).get(
                psychologist.email
            );


        // --------------------------------------------------
        // MIGRAR O E-MAIL ANTIGO DA BRUNA
        // --------------------------------------------------

        if (!psychologistUser) {

            const legacyPsychologist =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        email,
                        role

                    FROM users

                    WHERE
                        LOWER(email) =
                        LOWER(?)

                    AND role =
                        'PSYCHOLOGIST'

                    LIMIT 1
                `).get(
                    psychologist.legacyEmail
                );


            if (legacyPsychologist) {

                db.prepare(`
                    UPDATE users

                    SET
                        name = ?,
                        email = ?

                    WHERE id = ?

                    AND role =
                        'PSYCHOLOGIST'
                `).run(
                    psychologist.name,
                    psychologist.email,
                    legacyPsychologist.id
                );


                psychologistUser = {
                    id:
                        legacyPsychologist.id,

                    name:
                        psychologist.name,

                    email:
                        psychologist.email,

                    role:
                        'PSYCHOLOGIST'
                };


                console.log(
                    'E-mail da psicóloga fictícia atualizado.'
                );
            }
        }


        // --------------------------------------------------
        // CRIAR BRUNA CASO AINDA NÃO EXISTA
        // --------------------------------------------------

        if (!psychologistUser) {

            const passwordHash =
                bcrypt.hashSync(
                    psychologist.password,
                    12
                );


            const result =
                db.prepare(`
                    INSERT INTO users (
                        name,
                        email,
                        password_hash,
                        role
                    )

                    VALUES (?, ?, ?, ?)
                `).run(
                    psychologist.name,
                    psychologist.email,
                    passwordHash,
                    'PSYCHOLOGIST'
                );


            psychologistUser = {
                id:
                    Number(
                        result.lastInsertRowid
                    ),

                name:
                    psychologist.name,

                email:
                    psychologist.email,

                role:
                    'PSYCHOLOGIST'
            };


            console.log(
                'Psicóloga fictícia criada.'
            );

        } else {

            console.log(
                'Psicóloga fictícia preparada.'
            );
        }


        // ==================================================
        // USUÁRIO PACIENTE
        // ==================================================

        let patientUser =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    role

                FROM users

                WHERE
                    LOWER(email) =
                    LOWER(?)

                AND role =
                    'PATIENT'

                LIMIT 1
            `).get(
                patient.email
            );


        if (!patientUser) {

            const passwordHash =
                bcrypt.hashSync(
                    patient.password,
                    12
                );


            const result =
                db.prepare(`
                    INSERT INTO users (
                        name,
                        email,
                        password_hash,
                        role
                    )

                    VALUES (?, ?, ?, ?)
                `).run(
                    patient.name,
                    patient.email,
                    passwordHash,
                    'PATIENT'
                );


            patientUser = {
                id:
                    Number(
                        result.lastInsertRowid
                    ),

                name:
                    patient.name,

                email:
                    patient.email,

                role:
                    'PATIENT'
            };


            console.log(
                'Paciente fictício criado.'
            );

        } else {

            console.log(
                'Paciente fictício já existe.'
            );
        }


        // ==================================================
        // VÍNCULO DO PACIENTE COM A PSICÓLOGA
        // ==================================================

        const existingPatient =
            db.prepare(`
                SELECT
                    id,
                    psychologist_id

                FROM patients

                WHERE user_id = ?
            `).get(
                patientUser.id
            );


        if (!existingPatient) {

            db.prepare(`
                INSERT INTO patients (
                    user_id,
                    psychologist_id,
                    phone,
                    birth_date,
                    status,
                    default_session_price
                )

                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                patientUser.id,
                psychologistUser.id,
                null,
                null,
                'ACTIVE',
                150
            );


            console.log(
                'Vínculo do paciente fictício criado.'
            );

        } else {

            // Garante que João continua vinculado
            // à Bruna correta.

            if (
                Number(
                    existingPatient
                        .psychologist_id
                )
                !==
                Number(
                    psychologistUser.id
                )
            ) {

                db.prepare(`
                    UPDATE patients

                    SET psychologist_id = ?

                    WHERE id = ?
                `).run(
                    psychologistUser.id,
                    existingPatient.id
                );


                console.log(
                    'Vínculo do paciente fictício atualizado.'
                );

            } else {

                console.log(
                    'Paciente fictício já está vinculado.'
                );
            }
        }
    });


// ======================================================
// EXECUTAR SEED
// ======================================================

try {

    seedDatabase();


    console.log('');

    console.log(
        '======================================'
    );

    console.log(
        'EntreSessões - dados demo preparados'
    );

    console.log(
        '======================================'
    );

    console.log('');


    console.log('Psicóloga:');

    console.log(
        'E-mail: bruna.nascimento.psi@gmail.com'
    );

    console.log(
        'Senha: Tcc@12345'
    );

    console.log('');


    console.log('Paciente:');

    console.log(
        'E-mail: joaomaria@hotmail.com'
    );

    console.log(
        'Senha: Tcc@12345'
    );

    console.log('');


} catch (error) {

    console.error(
        'Erro ao preparar os dados fictícios:',
        error
    );

    process.exitCode = 1;


} finally {

    db.close();
}