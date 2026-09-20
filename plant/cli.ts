import { pathToFileURL } from 'node:url';
import { startPlantServer } from './bun-server';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.umask(0o077);
    const cert = process.env.SCADA_TLS_CERT;
    const key = process.env.SCADA_TLS_KEY;
    if (!!cert !== !!key) throw new Error('SCADA_TLS_CERT and SCADA_TLS_KEY must be configured together');
    const ca = process.env.SCADA_TLS_CA?.split(',').map(value => value.trim()).filter(Boolean);
    const http2 = process.env.SCADA_HTTP2 === undefined ? undefined : !['0', 'false', 'no'].includes(process.env.SCADA_HTTP2.toLowerCase());

    const app = await startPlantServer({
        port: Number(process.env.PORT ?? 4176),
        host: process.env.HOST ?? '127.0.0.1',
        unix: process.env.SCADA_UNIX_SOCKET,
        tls: cert && key ? { cert, key, ...(ca?.length ? { ca } : {}) } : undefined,
        http2,
        data: process.env.SCADA_DATABASE,
        repository: process.env.SCADA_PROJECT_REPO,
        publicUrl: process.env.SCADA_PUBLIC_URL,
        user: process.env.SCADA_USER,
        password: process.env.SCADA_PASSWORD,
        pushSubject: process.env.SCADA_PUSH_SUBJECT,
    });
    console.log(`SCADA: ${app.origin}/plant/app/\nDemo: ${app.origin}/plant/demo/`);
    if (app.initialPassword)
        console.log(`Initial engineer password (store securely): ${app.initialPassword}`);
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => void app.close().then(() => process.exit(0)));
}
