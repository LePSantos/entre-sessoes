const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');


// ======================================================
// CAMINHOS
// ======================================================

const projectFolder =
    __dirname;


const serverPath =
    path.join(
        projectFolder,
        'src',
        'server.js'
    );


const backupPath =
    path.join(
        projectFolder,
        'src',
        'server.backup-before-invite.js'
    );


// ======================================================
// VERIFICAR SERVER
// ======================================================

if (
    !fs.existsSync(serverPath)
) {

    console.error('');
    console.error(
        'ERRO: src/server.js não foi encontrado.'
    );
    console.error('');

    process.exit(1);
}


// ======================================================
// LER SERVER ATUAL
// ======================================================

let serverCode =
    fs.readFileSync(
        serverPath,
        'utf8'
    );


// Padronizar quebras de linha.

serverCode =
    serverCode.replace(
        /\r\n/g,
        '\n'
    );


// ======================================================
// FAZER BACKUP
// ======================================================

fs.writeFileSync(
    backupPath,
    serverCode,
    'utf8'
);


console.log('');
console.log(
    'Backup criado em:'
);

console.log(
    'src/server.backup-before-invite.js'
);

console.log('');


// ======================================================
// IMPORTAR NOVO MÓDULO
// ======================================================

const moduleImport =
    "const registerPatientInvitationRoutes = require('./patient-invitations');";


if (
    !serverCode.includes(
        moduleImport
    )
) {

    const dbImport =
        "const db = require('../database/db');";


    if (
        !serverCode.includes(
            dbImport
        )
    ) {

        console.error(
            'Não encontrei o ponto de importação do banco.'
        );

        process.exit(1);
    }


    serverCode =
        serverCode.replace(
            dbImport,

            `${dbImport}

${moduleImport}`
        );
}


// ======================================================
// ENCONTRAR ROTA ANTIGA
// ======================================================

const oldRouteStart =
    "app.post(\n    '/patients/new',";


const patientDetailsMarker =
`// ======================================================
// FICHA DO PACIENTE
// ======================================================`;


const startIndex =
    serverCode.indexOf(
        oldRouteStart
    );


const endIndex =
    serverCode.indexOf(
        patientDetailsMarker
    );


// ======================================================
// SE A ROTA NOVA AINDA NÃO FOI REGISTRADA
// ======================================================

const registrationCode =
`registerPatientInvitationRoutes({
    app,
    db,
    requireAuth,
    bcrypt
});


`;


if (
    serverCode.includes(
        registrationCode
    )
) {

    console.log(
        'O fluxo de convite já está instalado.'
    );

} else {


    if (
        startIndex === -1
    ) {

        console.error('');
        console.error(
            'ERRO: não encontrei a rota antiga de cadastro.'
        );
        console.error('');

        console.error(
            'Nenhuma alteração foi concluída.'
        );

        process.exit(1);
    }


    if (
        endIndex === -1 ||
        endIndex <= startIndex
    ) {

        console.error('');
        console.error(
            'ERRO: não encontrei o final da rota de cadastro.'
        );
        console.error('');

        console.error(
            'Nenhuma alteração foi concluída.'
        );

        process.exit(1);
    }


    // ==============================================
    // REMOVER ROTA ANTIGA
    // ==============================================

    const beforeOldRoute =
        serverCode.slice(
            0,
            startIndex
        );


    const afterOldRoute =
        serverCode.slice(
            endIndex
        );


    serverCode =
        beforeOldRoute
        +
        registrationCode
        +
        afterOldRoute;
}


// ======================================================
// SALVAR NOVO SERVER
// ======================================================

fs.writeFileSync(
    serverPath,
    serverCode,
    'utf8'
);


// ======================================================
// CONFERIR SINTAXE
// ======================================================

try {

    execFileSync(
        process.execPath,
        [
            '--check',
            serverPath
        ],
        {
            stdio: 'pipe'
        }
    );


    console.log(
        'server.js atualizado com sucesso.'
    );

    console.log(
        'Sintaxe do server.js verificada.'
    );


} catch (error) {


    console.error('');
    console.error(
        'Foi encontrado um erro após a alteração.'
    );

    console.error(
        'O backup será restaurado automaticamente.'
    );


    const backupCode =
        fs.readFileSync(
            backupPath,
            'utf8'
        );


    fs.writeFileSync(
        serverPath,
        backupCode,
        'utf8'
    );


    console.error('');
    console.error(
        'server.js restaurado.'
    );
    console.error('');


    process.exit(1);
}


// ======================================================
// FINAL
// ======================================================

console.log('');
console.log(
    '=============================================='
);

console.log(
    'FLUXO DE CONVITE INSTALADO'
);

console.log(
    '=============================================='
);

console.log('');

console.log(
    'Agora execute:'
);

console.log('');

console.log(
    'node database/init.js'
);

console.log(
    'npm.cmd start'
);

console.log('');