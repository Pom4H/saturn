import { pathToFileURL } from 'node:url';
import { startPlantServer } from './bun-server';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.umask(0o077);
    const app = await startPlantServer({ port: Number(process.env.PORT ?? 4176), host: process.env.HOST ?? '127.0.0.1', data: process.env.SCADA_DATABASE, repository: process.env.SCADA_PROJECT_REPO, publicUrl: process.env.SCADA_PUBLIC_URL, user: process.env.SCADA_USER, password: process.env.SCADA_PASSWORD, pushSubject: process.env.SCADA_PUSH_SUBJECT });
    console.log(`SCADA: ${app.origin}/plant/app/\nDemo: ${app.origin}/plant/demo/`);
    if (app.initialPassword)
        console.log(`Initial engineer password (store securely): ${app.initialPassword}`);
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => void app.close().then(() => process.exit(0)));
}
