// ======================================================
// NOTIFICAÇÕES - ENTRESESSÕES
// ======================================================


// Converte a chave pública VAPID
// para o formato que o navegador utiliza.

function urlBase64ToUint8Array(base64String) {

    const padding =
        '='.repeat(
            (4 - base64String.length % 4) % 4
        );

    const base64 =
        (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');


    const rawData =
        window.atob(base64);


    return Uint8Array.from(
        [...rawData].map(
            char => char.charCodeAt(0)
        )
    );
}


// ======================================================
// ATIVAR NOTIFICAÇÕES
// ======================================================

async function enableNotifications() {

    try {

        // Verifica se o navegador suporta
        // Service Worker e Push.

        if (
            !('serviceWorker' in navigator) ||
            !('PushManager' in window) ||
            !('Notification' in window)
        ) {

            alert(
                'Este navegador não oferece suporte às notificações do EntreSessões.'
            );

            return;
        }


        // Registra o Service Worker.

        await navigator.serviceWorker.register(
            '/sw.js'
        );


        const registration =
            await navigator.serviceWorker.ready;


        // Solicita autorização ao usuário.

        let permission =
            Notification.permission;


        if (
            permission === 'default'
        ) {

            permission =
                await Notification
                    .requestPermission();
        }


        if (
            permission !== 'granted'
        ) {

            alert(
                'As notificações não foram autorizadas.'
            );

            return;
        }


        // Busca a chave pública VAPID
        // no servidor.

        const keyResponse =
            await fetch(
                '/push/public-key'
            );


        if (
            !keyResponse.ok
        ) {

            throw new Error(
                'Não foi possível obter a chave de notificações.'
            );
        }


        const keyData =
            await keyResponse.json();


        // Verifica se este navegador
        // já possui uma assinatura.

        let subscription =
            await registration
                .pushManager
                .getSubscription();


        // Caso não tenha, cria uma.

        if (
            !subscription
        ) {

            subscription =
                await registration
                    .pushManager
                    .subscribe({
                        userVisibleOnly: true,

                        applicationServerKey:
                            urlBase64ToUint8Array(
                                keyData.publicKey
                            )
                    });
        }


        // Envia a assinatura para o Node.

        const response =
            await fetch(
                '/push/subscribe',
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(
                            subscription
                        )
                }
            );


        if (
            !response.ok
        ) {

            throw new Error(
                'O servidor não conseguiu salvar a assinatura.'
            );
        }


        alert(
            'Notificações ativadas com sucesso!'
        );

} catch (error) {

    console.error(
        'Erro ao ativar notificações:',
        error
    );

    alert(
        'Erro: ' + error.message
    );
}

}
