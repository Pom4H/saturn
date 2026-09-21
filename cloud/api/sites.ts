import type { IncomingMessage, ServerResponse } from 'node:http';
import { createSite, listSites, requireAdmin, siteIsOnline } from './_lib/state.js';
import { readJson, sendError, sendJson } from './_lib/http.js';

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
        requireAdmin(request);
        if (request.method === 'GET') {
            const sites = await listSites();
            sendJson(response, 200, sites.map(site => ({
                ...site,
                online: !!site.lastSeen && Date.now() - site.lastSeen.getTime() <= 15_000,
            })));
            return;
        }
        if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
            return;
        }
        const created = await createSite(await readJson(request));
        const root = (process.env.SATURN_CLOUD_ROOT_DOMAIN ?? '').replace(/^\.+|\.+$/g, '');
        const cloudOrigin = root ? `https://${root}` : null;
        const siteUrl = root ? `https://${created.site.slug}.${root}` : null;
        sendJson(response, 201, {
            id: created.site.id,
            slug: created.site.slug,
            name: created.site.name,
            siteUrl,
            edge: {
                url: cloudOrigin,
                site: created.site.slug,
                token: created.edgeToken,
            },
            credentials: {
                operator: { user: 'operator', password: created.operatorPassword },
                engineer: { user: 'engineer', password: created.engineerPassword },
            },
            env: {
                SATURN_CLOUD_URL: cloudOrigin,
                SATURN_CLOUD_SITE: created.site.slug,
                SATURN_CLOUD_TOKEN: created.edgeToken,
            },
        });
    }
    catch (error) {
        sendError(response, error);
    }
}
