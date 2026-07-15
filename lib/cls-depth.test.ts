import { beforeEach, describe, expect, it, vi } from 'vitest';

const ofetch = vi.fn();
const cacheTryGet = vi.fn(async (_key, getValue) => await getValue());
const loggerWarn = vi.fn();

vi.mock('@/utils/ofetch', () => ({ default: ofetch }));
vi.mock('@/utils/cache', () => ({ default: { tryGet: cacheTryGet } }));
vi.mock('@/utils/logger', () => ({ default: { warn: loggerWarn } }));

const getHandler = async () => (await import('./routes/cls/depth')).route.handler;
const createContext = (query = {}): any => ({
    req: {
        param: () => '1000',
        query: (key) => query[key],
    },
});

beforeEach(() => {
    ofetch.mockReset();
    cacheTryGet.mockClear();
    loggerWarn.mockClear();
});

describe('CLS 深度路由', () => {
    it('在游标没有严格递减时停止分页并保留已获取条目', async () => {
        const timestamp = Math.floor(new Date('2026-07-07T23:59:59+08:00').getTime() / 1000);
        let listRequests = 0;
        ofetch.mockImplementation((url) => {
            if (url.includes('/v3/depth/list/')) {
                listRequests++;
                return {
                    data: [
                        { id: 'valid', title: '有效文章', ctime: timestamp, source: 'CLS' },
                        { id: 'cursor', title: '游标文章', ctime: timestamp, source: 'CLS' },
                    ],
                };
            }
            return '<script id="__NEXT_DATA__">{"props":{"pageProps":{"articleDetail":{"content":"正文"}}}}</script>';
        });

        const handler = await getHandler();
        const result: any = await handler(createContext({ beginDate: '2026-07-07', endDate: '2026-07-07' }));

        expect(listRequests).toBe(1);
        expect(result.item).toHaveLength(2);
        expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('invalid cursor'));
    });

    it('跳过非法时间戳，并在详情请求失败时保留基础条目', async () => {
        const timestamp = Math.floor(new Date('2026-07-07T23:59:59+08:00').getTime() / 1000);
        ofetch.mockImplementation((url) => {
            if (url.includes('/v3/depth/list/')) {
                return {
                    data: [
                        { id: 'valid', title: '有效文章', ctime: timestamp, source: 'CLS' },
                        { id: 'invalid', title: '非法文章', ctime: 'bad-time', source: 'CLS' },
                        { id: 'old', title: '旧文章', ctime: timestamp - 24 * 60 * 60, source: 'CLS' },
                    ],
                };
            }
            throw new Error('detail unavailable');
        });

        const handler = await getHandler();
        const result: any = await handler(createContext({ beginDate: '2026-07-07', endDate: '2026-07-07' }));

        expect(result.item).toHaveLength(1);
        expect(result.item[0]).toMatchObject({ title: '有效文章', author: 'CLS' });
        expect(result.item[0].description).toBeUndefined();
        expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('detail request failed'));
    });

    it('将详情请求并发限制为 3', async () => {
        const timestamp = Math.floor(new Date('2026-07-07T23:59:59+08:00').getTime() / 1000);
        let inFlight = 0;
        let maxInFlight = 0;
        ofetch.mockImplementation(async (url) => {
            if (url.includes('/v3/depth/list/')) {
                return {
                    data: [
                        { id: 'one', title: '文章 1', ctime: timestamp, source: 'CLS' },
                        { id: 'two', title: '文章 2', ctime: timestamp, source: 'CLS' },
                        { id: 'three', title: '文章 3', ctime: timestamp, source: 'CLS' },
                        { id: 'four', title: '文章 4', ctime: timestamp, source: 'CLS' },
                    ],
                };
            }

            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 10));
            inFlight--;
            return '<script id="__NEXT_DATA__">{"props":{"pageProps":{"articleDetail":{"content":"正文"}}}}</script>';
        });

        const handler = await getHandler();
        const result: any = await handler(createContext({ beginDate: '2026-07-07', endDate: '2026-07-07' }));

        expect(result.item).toHaveLength(4);
        expect(maxInFlight).toBeLessThanOrEqual(3);
    });
});
