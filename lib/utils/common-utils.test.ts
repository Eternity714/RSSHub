import { describe, expect, it } from 'vitest';

import { collapseWhitespace, convertDateToISO8601, formatDateToUTC8, getLocalhostAddress, getSubPath, toTitleCase } from '@/utils/common-utils';

describe('common-utils', () => {
    it('toTitleCase', () => {
        expect(toTitleCase('RSSHub IS AS aweSOme aS henry')).toBe('Rsshub Is as Awesome as Henry');
    });

    it('formatDateToUTC8', () => {
        expect(formatDateToUTC8('')).toBe('');
        expect(formatDateToUTC8(null)).toBe(null);
        expect(formatDateToUTC8(undefined)).toBe(undefined);

        const date = new Date('2018-12-31T16:00:00.000Z');
        const expected = '2019-01-01 00:00:00 +08:00';
        expect(formatDateToUTC8(date)).toBe(expected);
        expect(formatDateToUTC8(date.toISOString())).toBe(expected);
        expect(formatDateToUTC8(date.toUTCString())).toBe(expected);
        expect(formatDateToUTC8(date.getTime())).toBe(expected);
        expect(formatDateToUTC8('something invalid')).toBe('Invalid Date');
    });

    it('convertDateToISO8601', () => {
        expect(convertDateToISO8601('')).toBe('');
        expect(convertDateToISO8601(null)).toBe(null);
        expect(convertDateToISO8601(undefined)).toBe(undefined);

        const date = new Date('2019-01-01');
        const expected = date.toISOString();
        expect(convertDateToISO8601(date)).toBe(expected);
        expect(convertDateToISO8601(date.toISOString())).toBe(expected);
        expect(convertDateToISO8601(date.toUTCString())).toBe(expected);
        expect(convertDateToISO8601(date.toLocaleString())).toBe(expected);
        expect(convertDateToISO8601('Tue, 01 Jan 2019 08:00:00 UTC+8')).toBe(expected);
        expect(convertDateToISO8601('2019-01-01 00:00:00 +08:00')).toBe('2018-12-31T16:00:00.000Z');

        expect(convertDateToISO8601('Tue, 01 Jan 2019 00:00:00')).toBe(new Date(date.getTime() + new Date().getTimezoneOffset() * 60 * 1000).toISOString());
        // need to pass a function in order to use `toThrow`
        expect(() => {
            convertDateToISO8601('something invalid');
        }).toThrow(RangeError);
    });

    it('collapseWhitespace', () => {
        expect(collapseWhitespace('')).toBe('');
        expect(collapseWhitespace(null)).toBe(null);
        expect(collapseWhitespace(undefined)).toBe(undefined);
        expect(collapseWhitespace('   \n\n\n    ')).toBe('');
        expect(collapseWhitespace('a string already collapsed')).toBe('a string already collapsed');
        expect(collapseWhitespace(' \n  a lot of     whitespaces   and \n\n\n\n linebreaks   \n\n ')).toBe('a lot of whitespaces and linebreaks');
    });

    it('getLocalhostAddress', () => {
        expect(getLocalhostAddress()).toBeInstanceOf(Array);
    });

    it('getSubPath', () => {
        expect(getSubPath({ req: { path: '/test/abc' } })).toBe('/abc');
        expect(getSubPath({ req: { path: '/test' } })).toBe('/');
    });
});
