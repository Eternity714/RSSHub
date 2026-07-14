import type { MiddlewareHandler } from 'hono';
import xxhash from 'xxhash-wasm';

import { config } from '@/config';
import RequestInProgressError from '@/errors/types/request-in-progress';
import type { Data } from '@/types';
import cacheModule from '@/utils/cache/index';

const bypassList = new Set(['/', '/robots.txt', '/logo.png', '/favicon.ico']);

const { h64ToString } = await xxhash();
// only give cache string, as the `!` condition tricky
// XXH64 is used to shrink key size
// plz, write these tips in comments!
const middleware: MiddlewareHandler = async (ctx, next) => {
    if (!cacheModule.status.available || bypassList.has(ctx.req.path)) {
        await next();
        return;
    }

    const requestPath = ctx.req.path;
    const searchParams = new URLSearchParams(new URL(ctx.req.url).searchParams);
    const format = searchParams.get('format') || 'rss';
    const limit = searchParams.get('limit');

    // 保留历史默认语义，同时让其余 query 参数隔离缓存结果。
    searchParams.delete('format');
    searchParams.delete('limit');
    searchParams.set('format', format);
    if (limit) {
        searchParams.set('limit', limit);
    }
    searchParams.sort();

    const cacheIdentifier = `${requestPath}?${searchParams.toString()}`;
    const key = 'rsshub:koa-redis-cache:' + h64ToString(cacheIdentifier);
    const controlKey = 'rsshub:path-requested:' + h64ToString(cacheIdentifier);

    let value = await cacheModule.globalCache.get(key);

    // Doesn't hit the cache? Try to become the fetcher and let others know!
    let isRequesting = false;
    if (!value) {
        isRequesting = !(await cacheModule.globalCache.claim(controlKey, config.cache.requestTimeout));
    }

    if (isRequesting) {
        let retryTimes = process.env.NODE_ENV === 'test' ? 1 : 10;
        let bypass = false;
        while (retryTimes > 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === 'test' ? 3000 : 6000));
            // eslint-disable-next-line no-await-in-loop
            if ((await cacheModule.globalCache.get(controlKey)) !== '1') {
                bypass = true;
                break;
            }
            retryTimes--;
        }
        if (!bypass) {
            throw new RequestInProgressError('This path is currently fetching, please come back later!');
        }
        value = await cacheModule.globalCache.get(key);
    }

    if (value) {
        ctx.status(200);
        ctx.header('RSSHub-Cache-Status', 'HIT');
        ctx.set('data', JSON.parse(value));
        await next();
        return;
    }

    if (isRequesting) {
        // waited out a stale claim without finding a cache entry, take over the fetch
        await cacheModule.globalCache.set(controlKey, '1', config.cache.requestTimeout);
    }

    // let routers control cache
    ctx.set('cacheKey', key);
    ctx.set('cacheControlKey', controlKey);

    try {
        await next();
    } catch (error) {
        await cacheModule.globalCache.set(controlKey, '0', config.cache.requestTimeout);
        throw error;
    }

    const data: Data = ctx.get('data');
    if (ctx.res.headers.get('Cache-Control') !== 'no-cache' && data) {
        data.lastBuildDate = new Date().toUTCString();
        ctx.set('data', data);
        const body = JSON.stringify(data);
        await cacheModule.globalCache.set(key, body, config.cache.routeExpire);
    }

    // We need to let it go, even no cache set.
    // Wait to set cache so the next request could be handled correctly
    await cacheModule.globalCache.set(controlKey, '0', config.cache.requestTimeout);
};

export default middleware;
