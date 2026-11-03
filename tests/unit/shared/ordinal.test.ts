import { describe, expect, it } from 'vitest';
import { ordinalSuffix } from '@shared/ordinal';

describe('ordinalSuffix', () => {
  it('uses st, nd, and rd for days ending in 1, 2, and 3, except the teens', () => {
    const expected = [
      '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
      '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th',
      '21st', '22nd', '23rd', '24th', '25th', '26th', '27th', '28th', '29th', '30th',
      '31st',
    ];

    const actual = Array.from({ length: expected.length }, (_, index) => `${index + 1}${ordinalSuffix(index + 1)}`);
    expect(actual).toEqual(expected);
  });
});
