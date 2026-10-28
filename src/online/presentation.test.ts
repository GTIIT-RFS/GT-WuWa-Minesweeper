import { expect, it } from 'vitest';
import { beijing, countdown, csvCell } from './presentation';
it('renders fixed Beijing time independent of the browser timezone', () => {
  expect(beijing('2030-06-01T10:00:00Z')).toBe('18:00');
  expect(beijing('2030-06-01T14:00:00Z')).toBe('22:00');
});
it('bounds display countdowns and escapes spreadsheet formulas and quotes', () => {
  expect(countdown(-1)).toBe('00:00:00');
  expect(countdown(3600000)).toBe('01:00:00');
  expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  expect(csvCell('土豆,队长')).toBe('"土豆,队长"');
});
