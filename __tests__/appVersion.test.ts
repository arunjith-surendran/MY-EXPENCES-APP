import { compareVersions } from '../src/lib/appVersion';

jest.mock('../src/lib/db', () => ({ getMeta: jest.fn(), setMeta: jest.fn() }));
jest.mock('../src/lib/api', () => ({ request: jest.fn() }));

describe('compareVersions', () => {
  it('compares numerically and fills missing parts with zero', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });
});
