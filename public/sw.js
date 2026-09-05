// ======================================================
// SERVICE WORKER - ENTRESESSÕES
// PWA + NOTIFICAÇÕES PUSH
// ======================================================


// ======================================================
// INSTALAÇÃO
// ======================================================

self.addEventListener(
    'install',

    () => {

        // Faz a nova versão do Service Worker
        // assumir mais rapidamente.

        self.skipWaiting();
    }
);


// ======================================================
// ATIVAÇÃO
// ======================================================

self.addEventListener(
    'activate',

    event => {

        event.waitUntil(
            clients.claim()
        );
    }
);


// ======================================================
// NOTIFICAÇÃO PUSH
// ======================================================

self.addEventListener(
    'push',

    event => {

        let data = {

            title:
                'EntreSessões',

            body:
                'Você recebeu uma nova solicitação prioritária.',

            url:
                '/support-requests'
        };


        if (
            event.data
        ) {

            try {

                data =
                    event.data.json();

            } catch (error) {

                console.error(
                    'Erro ao ler notificação:',
                    error
                );
            }
        }


        const options = {

            // Não exibimos nome de paciente
            // na notificação externa.

            body:
                data.body ||
                'Um paciente solicitou contato com prioridade.',

            icon:
                '/images/simbolo-bruna.png',

            badge:
                '/images/simbolo-bruna.png',

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

            self.registration
                .showNotification(

                    data.title ||
                    'EntreSessões - Solicitação prioritária',

                    options
                )
        );
    }
);


// ======================================================
// CLIQUE NA NOTIFICAÇÃO
// ======================================================

self.addEventListener(
    'notificationclick',

    event => {

        event.notification.close();


        const destination =
            event.notification.data?.url ||
            '/support-requests';


        event.waitUntil(

            clients
                .matchAll({

                    type:
                        'window',

                    includeUncontrolled:
                        true
                })

                .then(
                    windowClients => {


                        // Se o EntreSessões já estiver
                        // aberto, utiliza essa janela.

                        for (
                            const client
                            of windowClients
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


                        return null;
                    }
                )
        );
    }
);