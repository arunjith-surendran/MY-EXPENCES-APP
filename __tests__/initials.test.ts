import { initials } from '../src/lib/initials';
import type { User } from '../src/lib/api';

const user = (u: Partial<User>) => ({ name: null, email: null, ...u } as User);

describe('initials', () => {
  it.each([
    [user({ name: 'Ann Lee' }), 'AL'],
    [user({ name: 'ann' }), 'A'],
    [user({ email: 'john.doe@example.com' }), 'JD'],
    [user({ email: 'x@privaterelay.appleid.com' }), 'XP'],
    [user({}), '?'],
    [null, '?'],
  ])('%j → %s', (u, expected) => {
    expect(initials(u)).toBe(expected);
  });
});
