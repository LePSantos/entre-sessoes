const readline = require('readline');
const db = require('./database/db');


const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});


function tableExists(tableName) {

    const table =
        db.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            AND name = ?
        `).get(tableName);


    return Boolean(table);
}


rl.question(
    'Digite o e-mail do paciente de teste que deseja apagar: ',

    (email) => {

        const cleanEmail =
            String(email || '')
                .trim()
                .toLowerCase();


        if (!cleanEmail) {

            console.log(
                '\nNenhum e-mail informado.'
            );

            rl.close();
            db.close();

            return;
        }


        const user =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    role

                FROM users

                WHERE LOWER(email) = ?
            `).get(cleanEmail);


        if (!user) {

            console.log(
                '\nNenhum usuário encontrado com esse e-mail.'
            );

            rl.close();
            db.close();

            return;
        }


        if (user.role !== 'PATIENT') {

            console.log(
                '\nPor segurança, este script só apaga usuários do tipo PATIENT.'
            );

            rl.close();
            db.close();

            return;
        }


        const patient =
            db.prepare(`
                SELECT id
                FROM patients
                WHERE user_id = ?
            `).get(user.id);


        try {

            const removePatient =
                db.transaction(() => {


                    if (patient) {

                        const patientId =
                            patient.id;


                        // ----------------------------------
                        // NOTAS CLÍNICAS DAS SESSÕES
                        // ----------------------------------

                        if (
                            tableExists(
                                'clinical_notes'
                            )
                        ) {

                            db.prepare(`
                                DELETE FROM clinical_notes

                                WHERE session_id IN (
                                    SELECT id
                                    FROM sessions
                                    WHERE patient_id = ?
                                )
                            `).run(patientId);
                        }


                        // ----------------------------------
                        // SOLICITAÇÕES PRIORITÁRIAS
                        // ----------------------------------

                        if (
                            tableExists(
                                'support_requests'
                            )
                        ) {

                            db.prepare(`
                                DELETE FROM support_requests
                                WHERE patient_id = ?
                            `).run(patientId);
                        }


                        // ----------------------------------
                        // DIÁRIO EMOCIONAL
                        // ----------------------------------

                        if (
                            tableExists(
                                'diary_entries'
                            )
                        ) {

                            db.prepare(`
                                DELETE FROM diary_entries
                                WHERE patient_id = ?
                            `).run(patientId);
                        }


                        // ----------------------------------
                        // SESSÕES
                        // ----------------------------------

                        if (
                            tableExists(
                                'sessions'
                            )
                        ) {

                            db.prepare(`
                                DELETE FROM sessions
                                WHERE patient_id = ?
                            `).run(patientId);
                        }


                        // ----------------------------------
                        // PACIENTE
                        // ----------------------------------

                        db.prepare(`
                            DELETE FROM patients
                            WHERE id = ?
                        `).run(patientId);
                    }


                    // --------------------------------------
                    // CONVITES
                    // --------------------------------------

                    if (
                        tableExists(
                            'patient_invitations'
                        )
                    ) {

                        db.prepare(`
                            DELETE FROM patient_invitations
                            WHERE user_id = ?
                        `).run(user.id);
                    }


                    // --------------------------------------
                    // USUÁRIO
                    // --------------------------------------

                    db.prepare(`
                        DELETE FROM users

                        WHERE id = ?
                        AND role = 'PATIENT'
                    `).run(user.id);
                });


            removePatient();


            console.log('');
            console.log(
                '======================================'
            );

            console.log(
                'PACIENTE DE TESTE APAGADO'
            );

            console.log(
                '======================================'
            );

            console.log(
                `Nome removido: ${user.name}`
            );

            console.log(
                'E-mail, convite e cadastro removidos.'
            );

            console.log('');


        } catch (error) {

            console.error('');
            console.error(
                'Não foi possível apagar o paciente:'
            );

            console.error(
                error.message
            );

            console.error('');
        }


        rl.close();
        db.close();
    }
); 

