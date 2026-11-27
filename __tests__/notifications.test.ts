import {
  countUnread,
  type TeamNotification,
  toAnnounce,
} from '../src/lib/notifications';

jest.mock('../src/lib/db', () => ({ getMeta: jest.fn(), setMeta: jest.fn() }));

const n = (id: string, createdAt: string): TeamNotification => ({
  id,
  title: id,
  body: '',
  kind: 'custom',
  offerId: null,
  createdAt,
});

const items = [
  n('c', '2026-11-27T10:00:00.000Z'),
  n('b', '2026-11-26T10:00:00.000Z'),
  n('a', '2026-11-25T10:00:00.000Z'),
];

describe('toAnnounce', () => {
  it('shows only messages newer than the last one shown, oldest first', () => {
    expect(
      toAnnounce(items, '2026-11-25T10:00:00.000Z').map(x => x.id),
    ).toEqual(['b', 'c']);
  });

  it("doesn't replay old messages on the first sync", () => {
    expect(toAnnounce(items, null)).toEqual([]);
  });

  it('caps the number of banners', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      n(String(i), `2026-11-2${i}T10:00:00.000Z`),
    );
    expect(
      toAnnounce(many, '2026-11-01T00:00:00.000Z').map(x => x.id),
    ).toEqual(['3', '4', '5']);
  });
});

describe('countUnread', () => {
  it('counts messages after the last read one', () => {
    expect(countUnread(items, '2026-11-25T10:00:00.000Z')).toBe(2);
    expect(countUnread(items, null)).toBe(3);
    expect(countUnread(items, '2026-11-27T10:00:00.000Z')).toBe(0);
  });
});
