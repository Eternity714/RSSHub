import type { HeaderGeneratorOptions } from 'header-generator';
import { register } from 'node-network-devtools';
import { createFetch, type FetchContext } from 'ofetch';

import { config } from '@/config';
import logger from '@/utils/logger';

declare module 'ofetch' {
    interface FetchOptions {
        headerGeneratorOptions?: Partial<HeaderGeneratorOptions>;
    }
}

config.enableRemoteDebugging && process.env.NODE_ENV === 'dev' && register();

const maxRetryDelay = 30000;
export const getRetryDelay = ({ options, response }: FetchContext) => {
    const remainingRetries = typeof options.retry === 'number' ? options.retry : config.requestRetry;
    const initialRetries = typeof (options as any)._initialRetry === 'number' ? (options as any)._initialRetry : remainingRetries;
    (options as any)._initialRetry ??= initialRetries;
    const retryAttempt = Math.max(0, initialRetries - remainingRetries);
    const exponentialDelay = Math.min(10000, 1000 * 2 ** retryAttempt);
    const retryAfter = response?.headers.get('retry-after');
    let retryAfterDelay = 0;

    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            retryAfterDelay = seconds * 1000;
        } else {
            const retryAt = Date.parse(retryAfter);
            if (Number.isFinite(retryAt)) {
                retryAfterDelay = Math.max(0, retryAt - Date.now());
            }
        }
    }

    return Math.min(maxRetryDelay, Math.max(exponentialDelay, retryAfterDelay) + Math.floor(Math.random() * 250));
};

export const retryStatusCodes = [408, 409, 425, 429, 500, 502, 503, 504];

const rofetch = createFetch({ fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init) }).create({
    retryStatusCodes,
    retry: config.requestRetry,
    retryDelay: getRetryDelay,
    timeout: config.requestTimeout,
    onResponseError({ request, response, options }) {
        if (!options.retry) {
            return;
        }

        logger.warn(`Request ${request} with error ${response.status} remaining retry attempts: ${options.retry}`);
        if (!options.headers) {
            (options as any).headers = {};
        }
        if (options.headers instanceof Headers) {
            options.headers.set('x-prefer-proxy', '1');
        } else {
            ((options as any).headers as Record<string, string>)['x-prefer-proxy'] = '1';
        }
    },
    onRequestError({ request, error }) {
        logger.error(`Request ${request} fail: ${error.cause} ${error}`);
    },
    onResponse({ request, response }) {
        if (response.redirected) {
            logger.http(`Redirecting to ${response.url} for ${request}`);
        }
    },
});

export default rofetch;
