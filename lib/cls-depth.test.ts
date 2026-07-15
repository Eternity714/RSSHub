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
    it('从首屏获取 cursor，并使用首屏末项时间请求下一页', async () => {
        const timestamp = Math.floor(new Date('2026-07-07T23:59:59+08:00').getTime() / 1000);
        const nextTimestamp = timestamp - 1;
        ofetch.mockImplementation((url) => {
            if (url.includes('/v3/depth/home/assembled/')) {
                return {
                    data: {
                        depth_list: [
                            { id: 'valid', title: '有效文章', ctime: timestamp, source: 'CLS' },
                            { id: 'cursor', title: '游标文章', ctime: timestamp, source: 'CLS' },
                        ],
                    },
                };
            }
            if (url.includes('/v3/depth/list/')) {
                return {
                    data: [
                        { id: 'next', title: '下一页文章', ctime: nextTimestamp, source: 'CLS' },
                        { id: 'cursor', title: '重复游标', ctime: timestamp, source: 'CLS' },
                    ],
                };
            }
            return '<script id="__NEXT_DATA__">{"props":{"pageProps":{"articleDetail":{"content":"正文"}}}}</script>';
        });

        const handler = await getHandler();
        const result: any = await handler(createContext({ beginDate: '2026-07-07', endDate: '2026-07-07' }));

        const [homeUrl, homeOptions] = ofetch.mock.calls[0];
        const [listUrl, listOptions] = ofetch.mock.calls[1];
        expect(homeUrl).toContain('/v3/depth/home/assembled/1000');
        expect(homeOptions.query).toMatchObject({ app: 'CailianpressWeb', id: '1000', os: 'web', rn: '20', sv: '8.7.9' });
        expect(homeOptions.query).not.toHaveProperty('appName');
        expect(homeOptions.query).not.toHaveProperty('last_time');
        expect(listUrl).toContain('/v3/depth/list/1000');
        expect(listOptions.query).toMatchObject({ app: 'CailianpressWeb', id: '1000', last_time: timestamp + '', os: 'web', rn: '20', sv: '8.7.9' });
        expect(cacheTryGet).toHaveBeenCalledWith('cls:depth:home:1000', expect.any(Function), expect.any(Number), false);
        expect(cacheTryGet).toHaveBeenCalledWith(`cls:depth:list:1000:${timestamp}`, expect.any(Function), 90 * 24 * 60 * 60, false);
        expect(result.item).toHaveLength(3);
        expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('invalid cursor'));
    });

    it('跳过非法时间戳，并在详情请求失败时保留基础条目', async () => {
        const timestamp = Math.floor(new Date('2026-07-07T23:59:59+08:00').getTime() / 1000);
        ofetch.mockImplementation((url) => {
            if (url.includes('/v3/depth/home/assembled/')) {
                return {
                    data: {
                        depth_list: [
                            { id: 'valid', title: '有效文章', ctime: timestamp, source: 'CLS' },
                            { id: 'invalid', title: '非法文章', ctime: 'bad-time', source: 'CLS' },
                            { id: 'old', title: '旧文章', ctime: timestamp - 24 * 60 * 60, source: 'CLS' },
                        ],
                    },
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
            if (url.includes('/v3/depth/home/assembled/')) {
                return {
                    data: {
                        depth_list: [
                            { id: 'one', title: '文章 1', ctime: timestamp, source: 'CLS' },
                            { id: 'two', title: '文章 2', ctime: timestamp, source: 'CLS' },
                            { id: 'three', title: '文章 3', ctime: timestamp, source: 'CLS' },
                            { id: 'four', title: '文章 4', ctime: timestamp, source: 'CLS' },
                        ],
                    },
                };
            }
            if (url.includes('/v3/depth/list/')) {
                return { data: [] };
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
