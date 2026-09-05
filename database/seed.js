const db = require('./db');
const bcrypt = require('bcryptjs');

const psychologist = {
    name: 'Dra. Bruna Nascimento',
    email: 'bruna@entresessoes.local',
    password: 'Tcc@12345'
};

const existingUser = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(psychologist.email);

if (existingUser) {
    console.log('A psicóloga fictícia já existe no banco.');
} else {
    const passwordHash = bcrypt.hashSync(
        psychologist.password,
        12
    );

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

    console.log('Psicóloga fictícia criada com sucesso!');
    console.log('');
    console.log('E-mail: bruna@entresessoes.local');
    console.log('Senha: Tcc@12345');
}

db.close();