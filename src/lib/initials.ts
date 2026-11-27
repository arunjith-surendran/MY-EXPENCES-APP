import type { User } from './api';

/** Up to two letters from the name, or the email when there is no name. */
export function initials(user: Pick<User, 'name' | 'email'> | null) {
  const source = user?.name || user?.email || '';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[1][0] : '')
    ).toUpperCase() || '?'
  );
}
