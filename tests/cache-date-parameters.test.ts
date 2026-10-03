import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import xxhash from 'xxhash-wasm';

import cacheMiddleware from '../lib/middleware/cache';

const { values, readCache, writeCache, claimCache } = vi.hoisted(() => ({
    values: new Map<string, string>(),
    readCache: vi.fn(),
    writeCache: vi.fn(),
    claimCache: vi.fn(),
}));

vi.mock('../lib/config', () => ({ config: { format: 'rss', cache: { requestTimeout: 60, routeExpire: 300 } } }));
vi.mock('../lib/utils/cache/index', () => ({
    default: {
        status: { available: true },
        globalCache: { get: readCache, set: writeCache, claim: claimCache, supportsAtomicClaims: true },
    },
}));

const reportPath = '/eastmoney/report/strategyreport';

function createApp() {
    const app = new Hono();
    let fetchCount = 0;
    app.onError((error, ctx) => ctx.json({ name: error.name, message: error.message }, 400));
    app.use('*', cacheMiddleware);
    app.get('*', (ctx) => {
        if (!ctx.get('data')) {
            fetchCount++;
            ctx.set('data', { title: `Feed ${fetchCount}`, item: [], link: `https://example.com/${fetchCount}` });
        }
        return ctx.json(ctx.get('data'));
    });
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    readCache.mockImplementation((key: string) => values.get(key));
    writeCache.mockImplementation((key: string, value: string) => values.set(key, value));
    claimCache.mockImplementation((key: string) => {
        if (values.get(key) === '1') {
            return false;
        }
        values.set(key, '1');
        return true;
    });
});

describe('date range feed caching', () => {
    it('separates the default feed and different start and end dates', async () => {
        const app = createApp();
        const queries = ['', '?startDate=20260901', '?startDate=20260902', '?startDate=20260901&endDate=20260930', '?startDate=20260901&endDate=20260929', '?endDate=20260901'];

        const responses = await Promise.all(queries.map((query) => app.request(reportPath + query)));
        expect(responses.every((response) => !response.headers.has('RSSHub-Cache-Status'))).toBe(true);
        const feeds = await Promise.all(responses.map((response) => response.json()));
        expect(new Set(feeds.map((feed) => feed.title)).size).toBe(queries.length);

        const cached = await app.request(`${reportPath}?startDate=20260901&endDate=20260930`);
        expect(cached.headers.get('RSSHub-Cache-Status')).toBe('HIT');
        expect(await cached.json()).toMatchObject({ title: feeds[3].title });
    });

    it.each(['startDate=2026-09-01', 'beginDate=20260901', 'beginDate=2026/9/1', 'startDate=2026.9.1', 'startDate=&beginDate=20260901'])('shares cached results for the equivalent range %s', async (query) => {
        const app = createApp();
        await app.request(`${reportPath}?startDate=20260901&endDate=20260930`);

        const response = await app.request(`${reportPath}?${query}&endDate=2026-09-30`);
        expect(response.headers.get('RSSHub-Cache-Status')).toBe('HIT');
        expect(await response.json()).toMatchObject({ title: 'Feed 1' });
        expect(claimCache).toHaveBeenCalledOnce();
    });

    it('uses startDate precedence consistently with the route', async () => {
        const app = createApp();
        await app.request(`${reportPath}?startDate=20260901`);

        const response = await app.request(`${reportPath}?startDate=20260901&beginDate=invalid-date`);
        expect(response.headers.get('RSSHub-Cache-Status')).toBe('HIT');
        expect(await response.json()).toMatchObject({ title: 'Feed 1' });
    });

    it.each(['startDate=20260230', 'beginDate=20260229', 'endDate=2026-04-31', 'startDate=invalid-date&beginDate=20260901'])('rejects invalid dates before accessing the cache: %s', async (query) => {
        const response = await createApp().request(`${reportPath}?${query}`);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ name: 'InvalidParameterError' });
        expect(readCache).not.toHaveBeenCalled();
        expect(claimCache).not.toHaveBeenCalled();
    });

    it('hashes the named date values in YYYYMMDD format for both feed and request coordination keys', async () => {
        const { h64ToString } = await xxhash();
        await createApp().request(`${reportPath}?beginDate=2026-9-1&endDate=2026/9/30`);
        const hash = h64ToString(`${reportPath}:rss:startDate=20260901:endDate=20260930`);

        expect(readCache).toHaveBeenCalledWith(`rsshub:koa-redis-cache:${hash}`);
        expect(claimCache).toHaveBeenCalledWith(`rsshub:path-requested:${hash}`, 60);
    });

    it('keeps the existing cache key for requests with no dates', async () => {
        const { h64ToString } = await xxhash();
        const app = createApp();
        await app.request(reportPath);
        const response = await app.request(`${reportPath}?startDate=&beginDate=&endDate=`);

        expect(readCache).toHaveBeenCalledWith(`rsshub:koa-redis-cache:${h64ToString(`${reportPath}:rss`)}`);
        expect(response.headers.get('RSSHub-Cache-Status')).toBe('HIT');
    });

    it.each(['format=json', 'limit=10', 'pageNum=2', 'pageSize=50'])('continues to distinguish %s when dates are present', async (query) => {
        const app = createApp();
        await app.request(`${reportPath}?startDate=20260901`);
        const response = await app.request(`${reportPath}?startDate=20260901&${query}`);

        expect(response.headers.get('RSSHub-Cache-Status')).toBeNull();
        expect(await response.json()).toMatchObject({ title: 'Feed 2' });
    });

    it('keeps date parameter names distinct on routes with different alias semantics', async () => {
        const app = createApp();
        const beginResponse = await app.request('/cls/depth?beginDate=20260901');
        const startResponse = await app.request('/cls/depth?startDate=20260901');
        const otherBeginResponse = await app.request('/cls/depth?beginDate=20260902');
        const cached = await app.request('/cls/depth?beginDate=20260901');

        expect(await beginResponse.json()).toMatchObject({ title: 'Feed 1' });
        expect(await startResponse.json()).toMatchObject({ title: 'Feed 2' });
        expect(await otherBeginResponse.json()).toMatchObject({ title: 'Feed 3' });
        expect(cached.headers.get('RSSHub-Cache-Status')).toBe('HIT');
        expect(await cached.json()).toMatchObject({ title: 'Feed 1' });
    });

    it('preserves other routes accepting dates in formats outside the Eastmoney contract', async () => {
        const response = await createApp().request('/cls/depth?beginDate=2026-09-01T00%3A00%3A00%2B08%3A00');

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ title: 'Feed 1' });
    });
});
