import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { route } from '../lib/routes/eastmoney/report';

const { getReports, postReports, getCachedArticle } = vi.hoisted(() => ({
    getReports: vi.fn(),
    postReports: vi.fn(),
    getCachedArticle: vi.fn(),
}));

vi.mock('../lib/utils/got', () => ({ default: Object.assign(getReports, { post: postReports }) }));
vi.mock('../lib/utils/cache', () => ({ default: { tryGet: getCachedArticle } }));

const dateInputs = ['20260901', '2026-09-01', '2026/09/01', '2026.09.01', '2026-9-1', '2026/9/1', '2026.9.1'];

function requestFeed(query: Record<string, string> = {}, category = 'strategyreport') {
    const app = new Hono();
    app.onError((error, ctx) => ctx.json({ name: error.name, message: error.message }, 400));
    app.get('/report/:category', async (ctx) => {
        await route.handler(ctx);
        return ctx.body(null);
    });
    return app.request(`/report/${category}?${new URLSearchParams(query)}`);
}

describe('eastmoney report date parameters', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 3, 12));
        vi.clearAllMocks();
        const response = {
            data: {
                data: [
                    {
                        title: 'Report',
                        orgSName: 'Broker',
                        stockName: 'Stock',
                        researcher: 'Researcher',
                        infoCode: '123',
                        encodeUrl: 'report-123',
                        publishDate: '2026-09-01T08:00:00',
                    },
                ],
            },
        };
        getReports.mockResolvedValue(response);
        postReports.mockResolvedValue(response);
        getCachedArticle.mockResolvedValue({ title: 'Report', description: 'Cached article' });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe.each(['startDate', 'beginDate'])('%s', (fieldName) => {
        it.each(dateInputs)('sends %s to the upstream API as YYYY-MM-DD', async (value) => {
            const response = await requestFeed({ [fieldName]: value });

            expect(response.status).toBe(200);
            expect(getReports).toHaveBeenCalledWith('https://reportapi.eastmoney.com/report/jg', {
                searchParams: {
                    beginTime: '2026-09-01',
                    endTime: '2026-10-03',
                    qType: 2,
                    pageNo: 1,
                    pageSize: 20,
                },
            });
            expect(getCachedArticle).toHaveBeenCalledOnce();
        });
    });

    it('prioritizes a nonempty startDate over beginDate', async () => {
        await requestFeed({ startDate: '20260902', beginDate: 'invalid-date' });

        expect(getReports).toHaveBeenCalledWith(expect.any(String), {
            searchParams: expect.objectContaining({ beginTime: '2026-09-02' }),
        });
    });

    it('falls back to beginDate when startDate is empty', async () => {
        await requestFeed({ startDate: '', beginDate: '20260901' });

        expect(getReports).toHaveBeenCalledWith(expect.any(String), {
            searchParams: expect.objectContaining({ beginTime: '2026-09-01' }),
        });
    });

    it.each<Record<string, string>>([{}, { startDate: '', beginDate: '', endDate: '' }])('preserves default dates for %j', async (query) => {
        await requestFeed(query);

        expect(getReports).toHaveBeenCalledWith(expect.any(String), {
            searchParams: expect.objectContaining({ beginTime: '2026-10-01', endTime: '2026-10-03' }),
        });
    });

    it.each(dateInputs)('normalizes endDate %s for the upstream API', async (endDate) => {
        await requestFeed({ startDate: '20260801', endDate });

        expect(getReports).toHaveBeenCalledWith(expect.any(String), {
            searchParams: expect.objectContaining({ beginTime: '2026-08-01', endTime: '2026-09-01' }),
        });
    });

    it('accepts a valid leap day', async () => {
        const response = await requestFeed({ beginDate: '2024-2-29' });

        expect(response.status).toBe(200);
        expect(getReports).toHaveBeenCalledWith(expect.any(String), {
            searchParams: expect.objectContaining({ beginTime: '2024-02-29' }),
        });
    });

    it.each([
        ['startDate', '20260229'],
        ['startDate', '2026-02-30'],
        ['startDate', '20261301'],
        ['startDate', '20260001'],
        ['startDate', '20260900'],
        ['startDate', '2026/09-01'],
        ['startDate', '2026091'],
        ['startDate', '0000-01-01'],
        ['startDate', 'invalid-date'],
        ['beginDate', '2026.04.31'],
        ['endDate', '2026/2/29'],
    ])('rejects invalid %s=%s before requesting upstream data', async (fieldName, value) => {
        const response = await requestFeed({ [fieldName]: value });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            name: 'InvalidParameterError',
            message: expect.stringContaining(`Invalid ${fieldName}`),
        });
        expect(getReports).not.toHaveBeenCalled();
        expect(postReports).not.toHaveBeenCalled();
    });

    it('rejects an invalid nonempty startDate even when beginDate is valid', async () => {
        const response = await requestFeed({ startDate: '20260229', beginDate: '20260901' });

        expect(response.status).toBe(400);
        expect(getReports).not.toHaveBeenCalled();
    });

    it('normalizes dates for stock report POST requests', async () => {
        const response = await requestFeed({ startDate: '20260901', endDate: '2026/9/3' }, 'stock');

        expect(response.status).toBe(200);
        expect(postReports).toHaveBeenCalledWith('https://reportapi.eastmoney.com/report/list2', {
            json: {
                beginTime: '2026-09-01',
                endTime: '2026-09-03',
                pageNo: 1,
                pageSize: 20,
            },
        });
        expect(getReports).not.toHaveBeenCalled();
    });
});
