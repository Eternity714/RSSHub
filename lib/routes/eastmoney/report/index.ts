import { load } from 'cheerio';
import dayjs from 'dayjs';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { normalizeDateParameter } from '@/utils/normalize-date-parameter';
import { parseDateInTimezone } from '@/utils/parse-date-in-timezone';

const reportType = {
    brokerreport: '券商晨报',
    industry: '行业研报',
    macresearch: '宏观研究',
    strategyreport: '策略报告',
    stock: '个股研报',
};

const linkType = {
    brokerreport: 'zw_brokerreport',
    industry: 'zw_industry',
    macresearch: 'zw_macresearch',
    strategyreport: 'zw_strategy',
    stock: 'info',
};

const qType = {
    brokerreport: 4,
    industry: 1,
    macresearch: 3,
    strategyreport: 2,
    stock: 0,
};

const categories = Object.keys(reportType) as Array<keyof typeof reportType>;
const pageSize = 20;

const baseUrl = 'https://data.eastmoney.com';
const reqUrl = 'https://reportapi.eastmoney.com/report/jg';
const reqUrlStock = 'https://reportapi.eastmoney.com/report/list2';

function parseDateParameter(value: string, fieldName: string, defaultValue: string) {
    if (!value) {
        return defaultValue;
    }

    const normalizedDate = normalizeDateParameter(value, fieldName);
    return `${normalizedDate.slice(0, 4)}-${normalizedDate.slice(4, 6)}-${normalizedDate.slice(6, 8)}`;
}

async function request(category: string, beginTime: string, endTime: string, pageNo: number, pageSize: number): Promise<DataItem[]> {
    if (category === 'stock') {
        const { data: response } = await got.post(reqUrlStock, {
            json: {
                beginTime,
                endTime,
                pageNo,
                pageSize,
            },
        });

        const reports = response.data ?? [];

        return reports.map((item) => ({
            title: `[${item.orgSName}][${item.stockName}]${item.title}`,
            link: `${baseUrl}/report/${linkType[category as keyof typeof linkType]}/${item.infoCode}.html`,
            pubDate: parseDateInTimezone(item.publishDate, 8),
            author: item.researcher,
        }));
    }

    const { data: response } = await got(reqUrl, {
        searchParams: {
            beginTime,
            endTime,
            qType: qType[category as keyof typeof qType],
            pageNo,
            pageSize,
        },
    });

    const reports = response.data ?? [];

    return reports.map((item) => ({
        title: `[${item.orgSName}]${item.title}`,
        link: `${baseUrl}/report/${linkType[category as keyof typeof linkType]}.jshtml?encodeUrl=${item.encodeUrl}`,
        pubDate: parseDateInTimezone(item.publishDate, 8),
        author: item.researcher,
    }));
}

async function handler(ctx) {
    const category = (ctx.req.param('category') ?? 'strategyreport') as string;
    if (!categories.includes(category as keyof typeof reportType)) {
        throw new InvalidParameterError(`Invalid category: ${category}. Expected one of ${categories.join(', ')}`);
    }
    const startDate = ctx.req.query('startDate');
    const beginDate = parseDateParameter(startDate || ctx.req.query('beginDate') || '', startDate ? 'startDate' : 'beginDate', dayjs().subtract(2, 'day').format('YYYY-MM-DD'));
    const endDate = parseDateParameter(ctx.req.query('endDate') ?? '', 'endDate', dayjs().format('YYYY-MM-DD'));

    const items: DataItem[] = [];
    let page = 1;

    while (true) {
        // Subsequent requests depend on the number of reports returned by the current page.
        // eslint-disable-next-line no-await-in-loop
        const currentItems = (await request(category, beginDate, endDate, page, pageSize)) ?? [];

        items.push(...currentItems);

        if (currentItems.length < pageSize) {
            break;
        }

        page++;
    }

    const feedItems = await Promise.all(
        items.map(async (item) => {
            const cached = await cache.tryGet(item.link!, async () => {
                try {
                    const { data: response } = await got(item.link!);
                    const $ = load(response);

                    const pdfLink = $('.pdf-link').attr('href');
                    item.link = pdfLink || item.link;
                    item.description = $('.ctx-content').html();

                    return item;
                } catch {
                    return item;
                }
            });

            return { ...cached, pubDate: item.pubDate };
        })
    );

    return {
        title: `东方财富网-${reportType[category as keyof typeof reportType]}`,
        link: `${baseUrl}/report/${category}`,
        item: feedItems,
    };
}

export const route: Route = {
    path: '/report/:category',
    categories: ['finance'],
    view: ViewType.Articles,
    example: '/eastmoney/report/strategyreport?beginDate=2026-01-01&endDate=2026-01-31',
    description:
        '可通过查询参数 `startDate`（兼容别名 `beginDate`）和 `endDate` 指定日期范围。开始日期默认为当前日期前 2 天，结束日期默认为当前日期。日期支持 `YYYYMMDD`、`YYYY-MM-DD`、`YYYY/MM/DD`、`YYYY.MM.DD`，带分隔符时月份和日期可省略前导零。同时提供非空的 `startDate` 和 `beginDate` 时，优先使用 `startDate`。',
    parameters: {
        category: {
            description: '研报类型',
            options: [
                { value: 'strategyreport', label: '策略报告' },
                { value: 'macresearch', label: '宏观研究' },
                { value: 'brokerreport', label: '券商晨报' },
                { value: 'industry', label: '行业研报' },
                { value: 'stock', label: '个股研报' },
            ],
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['data.eastmoney.com/report/:category'],
        },
    ],
    name: '研究报告',
    maintainers: ['syzq', 'yeshunfa'],
    handler,
};
