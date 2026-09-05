// ======================================================
// PWA - ENTRESESSÕES
// ======================================================


if (
    'serviceWorker' in navigator
) {

    window.addEventListener(
        'load',

        async () => {

            try {

                const registration =
                    await navigator
                        .serviceWorker
                        .register(
                            '/sw.js',
                            {
                                scope: '/'
                            }
                        );


                console.log(
                    'EntreSessões PWA registrado:',
                    registration.scope
                );


            } catch (error) {

                console.error(
                    'Não foi possível registrar o PWA:',
                    error
                );
            }
        }
    );
}