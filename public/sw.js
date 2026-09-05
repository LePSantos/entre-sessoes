// ======================================================
// SERVICE WORKER - ENTRESESSÕES
// Recebe notificações Push em segundo plano
// ======================================================


// QUANDO UMA NOTIFICAÇÃO PUSH CHEGAR

self.addEventListener(
    'push',

    event => {

        let data = {
            title: 'EntreSessões',
            body: 'Você recebeu uma nova solicitação prioritária.'
        };


        // Se o servidor enviou informações,
        // usamos essas informações.

        if (event.data) {

            try {

                data = event.data.json();

            } catch (error) {

                console.error(
                    'Erro ao ler notificação:',
                    error
                );

            }

        }


        const options = {

            // IMPORTANTE:
            // não mostramos o nome do paciente
            // na notificação externa.

            body:
                data.body ||
                'Um paciente solicitou contato com prioridade.',

            tag:
                'priority-request',

            renotify:
                true,

            requireInteraction:
                true,

            data: {
                url:
                    data.url ||
                    '/support-requests'
            }
        };


        event.waitUntil(

            self.registration.showNotification(
                data.title ||
                'EntreSessões - Solicitação prioritária',

                options
            )

        );

    }
);


// ======================================================
// QUANDO A PSICÓLOGA CLICAR NA NOTIFICAÇÃO
// ======================================================

self.addEventListener(
    'notificationclick',

    event => {

        event.notification.close();


        const destination =
            event.notification.data?.url ||
            '/support-requests';


        event.waitUntil(

            clients.matchAll({
                type: 'window',
                includeUncontrolled: true
            })
            .then(windowClients => {

                // Se EntreSessões já estiver aberto,
                // usamos a janela existente.

                for (
                    const client of windowClients
                ) {

                    if (
                        'focus' in client
                    ) {

                        client.navigate(
                            destination
                        );

                        return client.focus();
                    }

                }


                // Caso contrário,
                // abre uma nova janela.

                if (
                    clients.openWindow
                ) {

                    return clients.openWindow(
                        destination
                    );

                }

            })

        );

    }
);