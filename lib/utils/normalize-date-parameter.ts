import InvalidParameterError from '@/errors/types/invalid-parameter';

export function normalizeDateParameter(value: string, fieldName: string): string {
    const input = value.trim();
    const compactMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(input);
    const separatedMatch = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(input);
    const components = compactMatch?.slice(1) ?? (separatedMatch ? [separatedMatch[1], separatedMatch[3], separatedMatch[4]] : undefined);
    const errorMessage = `Invalid ${fieldName}. Expected a valid calendar date in YYYYMMDD, YYYY-MM-DD, YYYY/MM/DD or YYYY.MM.DD format.`;

    if (!components) {
        throw new InvalidParameterError(errorMessage);
    }

    const [year, month, day] = components.map(Number);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
        throw new InvalidParameterError(errorMessage);
    }

    return `${components[0]}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}
