import os from 'node:os';

import title from 'title';

import { config } from '@/config';
import { parseDate } from '@/utils/parse-date';

// convert a string into title case
const toTitleCase = (str: string) => title(str);

const rWhitespace = /\s+/;
const rAllWhitespace = /\s+/g;
const UTC8_OFFSET = 8 * 60 * 60 * 1000;
const padNumber = (num: number) => num.toString().padStart(2, '0');

// collapse all whitespaces into a single space (like "white-space: normal;" would do), and trim
const collapseWhitespace = (str?: string | null) => {
    if (str && rWhitespace.test(str)) {
        return str.replaceAll(rAllWhitespace, ' ').trim();
    }
    return str;
};

const formatDateToUTC8 = (date?: string | Date | number | null) => {
    if (!date) {
        return date;
    }

    if (typeof date !== 'object') {
        date = parseDate(date);
    }

    if (Number.isNaN(date.getTime())) {
        return 'Invalid Date';
    }

    const utc8Date = new Date(date.getTime() + UTC8_OFFSET);

    return `${utc8Date.getUTCFullYear()}-${padNumber(utc8Date.getUTCMonth() + 1)}-${padNumber(utc8Date.getUTCDate())} ${padNumber(utc8Date.getUTCHours())}:${padNumber(utc8Date.getUTCMinutes())}:${padNumber(utc8Date.getUTCSeconds())} +08:00`;
};

const convertDateToISO8601 = (date?: string | Date | number | null) => {
    if (!date) {
        return date;
    }
    if (typeof date !== 'object') {
        // some routes may call `.toUTCString()` before passing the date to ctx...
        date = parseDate(date);
    }
    return date.toISOString();
};

const getSubPath = (ctx) => {
    const subPath = ctx.req.path.replace(/\/[^/]*/, '') || '/';
    return subPath;
};

const getLocalhostAddress = () => {
    const interfaces = os.networkInterfaces();
    const address = Object.keys(interfaces)
        .flatMap((name) => interfaces[name] ?? [])
        .filter((iface) => iface?.family === 'IPv4' && !iface.internal)
        .map((iface) => iface?.address)
        .filter(Boolean);
    if (!config.disableIPv6) {
        address.push('[::]');
    }
    return address;
};

export { collapseWhitespace, convertDateToISO8601, formatDateToUTC8, getLocalhostAddress, getSubPath, toTitleCase };
