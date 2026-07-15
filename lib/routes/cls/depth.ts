import { load } from 'cheerio';
import pMap from 'p-map';

import { config } from '@/config';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

import { renderDepthDescription } from './templates/depth';
import { getSearchParams, rootUrl } from './utils';

const categories = {
    1000: '头条',
    1003: '股市',
    1135: '港股',
    1007: '环球',
    1005: '公司',
    1118: '券商',
    1110: '基金',
    1006: '地产',
    1032: '金融',
    1119: '汽车',
    1111: '科创',
    1127: '创业版',
    1160: '品见',
    1124: '期货',
    1176: '投教',
};

const historicalPageCacheExpire = 90 * 24 * 60 * 60;
const initialPageCacheExpire = config.cache.routeExpire;
const datePattern = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const depthSearchParams = {
    app: 'CailianpressWeb',
    appName: undefined,
    rn: 20,
};

const getUtcDate = (dateString, fieldName, defaultDate) => {
    const date = dateString ?? defaultDate;
    if (!datePattern.test(date)) {
        throw new InvalidParameterError(`Invalid ${fieldName} format. Expected YYYY-MM-DD.`);
    }

    const [year, month, day] = date.split('-').map(Number);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsedDate = new Date(timestamp);
    if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 || parsedDate.getUTCDate() !== day) {
        throw new InvalidParameterError(`Invalid ${fieldName}. Expected a valid YYYY-MM-DD date.`);
    }

    return date;
};

const getCurrentUtcDate = (offset = 0) => {
    const date = new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset)).toISOString().slice(0, 10);
};

const getUtcTimestamp = (dateString, endOfDay = false) => {
    const [year, month, day] = dateString.split('-').map(Number);
    return Math.floor(Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0) / 1000);
};

const getDepthSearchParams = (category, moreParams?) =>
    getSearchParams({
        ...depthSearchParams,
        id: category,
        ...moreParams,
    });

const filterArticles = (articles, beginDateTimestamp, endDateTimestamp) =>
    articles.filter((item) => {
        const timestamp = Number(item.ctime);
        return Number.isFinite(timestamp) && timestamp >= beginDateTimestamp && timestamp <= endDateTimestamp;
    });

async function getInitialPage(category) {
    const response = await cache.tryGet(`cls:depth:home:${category}`, async () => await ofetch(`${rootUrl}/v3/depth/home/assembled/${category}`, { query: getDepthSearchParams(category) }), initialPageCacheExpire, false);
    const articles = response.data?.depth_list;

    if (!Array.isArray(articles)) {
        throw new TypeError(`Unexpected CLS depth home response for category ${category}`);
    }

    return articles;
}

async function getHistoricalPage(category, cursor) {
    const cacheKey = `cls:depth:list:${category}:${cursor}`;
    const emptyPageError = new Error('CLS depth historical page is empty');

    try {
        const response = await cache.tryGet(
            cacheKey,
            async () => {
                const response = await ofetch(`${rootUrl}/v3/depth/list/${category}`, { query: getDepthSearchParams(category, { last_time: cursor }) });
                if (!Array.isArray(response.data)) {
                    throw new TypeError(`Unexpected CLS depth list response for category ${category}`);
                }
                if (response.data.length === 0) {
                    throw emptyPageError;
                }
                return response;
            },
            historicalPageCacheExpire,
            false
        );

        if (!Array.isArray(response.data)) {
            throw new TypeError(`Unexpected CLS depth list response for category ${category}`);
        }

        return response.data;
    } catch (error) {
        if (error === emptyPageError) {
            return [];
        }
        throw error;
    }
}

export const route: Route = {
    path: '/depth/:category?',
    categories: ['finance'],
    example: '/cls/depth/1000',
    parameters: { category: '分类代码，可在首页导航栏的目标网址 URL 中找到' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '深度',
    maintainers: ['nczitzk'],
    handler,
    description: `| 头条 | 股市 | 港股 | 环球 | 公司 | 券商 | 基金 | 地产 | 金融 | 汽车 | 科创 | 创业版 | 品见 | 期货 | 投教 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ------ | ---- | ---- | ---- |
| 1000 | 1003 | 1135 | 1007 | 1005 | 1118 | 1110 | 1006 | 1032 | 1119 | 1111 | 1127   | 1160 | 1124 | 1176 |`,
};

async function handler(ctx) {
    const category = ctx.req.param('category') ?? '1000';
    const beginDate = getUtcDate(ctx.req.query('beginDate'), 'beginDate', getCurrentUtcDate(-2));
    const endDate = getUtcDate(ctx.req.query('endDate'), 'endDate', getCurrentUtcDate());

    if (beginDate > endDate) {
        throw new InvalidParameterError('beginDate must be earlier than or equal to endDate.');
    }

    const beginDateTimestamp = getUtcTimestamp(beginDate);
    const endDateTimestamp = getUtcTimestamp(endDate, true);

    const title = categories[category];

    if (!title) {
        throw new InvalidParameterError('Bad category. See <a href="https://docs.rsshub.app/routes/finance#cai-lian-she-shen-du">docs</a>');
    }

    const currentUrl = `${rootUrl}/depth?id=${category}`;
    const articles: any[] = [];
    const articleIds = new Set();
    let currentArticles = await getInitialPage(category);
    let lastTime: number | undefined;

    while (true) {
        if (currentArticles.length === 0) {
            break;
        }

        const newArticles = filterArticles(currentArticles, beginDateTimestamp, endDateTimestamp).filter((item) => !articleIds.has(item.id));
        for (const item of newArticles) {
            articleIds.add(item.id);
        }
        articles.push(...newArticles);

        const currentLastTime = Number(currentArticles.at(-1).ctime);
        if (!Number.isFinite(currentLastTime) || (lastTime !== undefined && currentLastTime >= lastTime)) {
            logger.warn(`CLS depth pagination stopped due to invalid cursor: category=${category}, beginDate=${beginDate}, endDate=${endDate}, lastTime=${lastTime}, currentLastTime=${currentLastTime}`);
            break;
        }

        if (currentLastTime < beginDateTimestamp) {
            break;
        }

        lastTime = currentLastTime;
        // 后续请求依赖上一次响应中的 ctime，无法并行请求
        // eslint-disable-next-line no-await-in-loop
        currentArticles = await getHistoricalPage(category, lastTime);
    }

    let items: any[] = articles.map((item) => ({
        title: item.title || item.brief,
        link: `${rootUrl}/detail/${item.id}`,
        pubDate: parseDate(item.ctime, 'X'),
        author: item.source,
        category: item.article_tag?.map((tag) => tag.name),
        image: item.image,
    }));

    items = await pMap(
        items,
        async (item) => {
            try {
                return await cache.tryGet(item.link, async () => {
                    const detailResponse = await ofetch(item.link);

                    const content = load(detailResponse);
                    const nextData = JSON.parse(content('script#__NEXT_DATA__').text());
                    const articleDetail = nextData.props.pageProps.articleDetail;

                    item.author = articleDetail.author?.name ?? item.author ?? '';
                    item.description = renderDepthDescription(articleDetail);

                    return item;
                });
            } catch (error) {
                logger.warn(`CLS depth detail request failed: category=${category}, link=${item.link}, error=${error}`);
                return item;
            }
        },
        { concurrency: 3 }
    );

    return {
        title: `财联社 - ${title}`,
        link: currentUrl,
        item: items,
    };
}
