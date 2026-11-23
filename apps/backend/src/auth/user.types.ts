import type { PublicUser, Role } from '@pixelboard/shared';

/** zapis iz users_by_username; sadrži password_hash i ne sme da napusti auth modul */
export interface UserCredentials {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  createdAt: Date;
}

export type CreateUserResult =
  { ok: true; user: PublicUser } | { ok: false; reason: 'taken' };

export function toPublicUser(u: {
  id: string;
  username: string;
  role: Role;
}): PublicUser {
  return { id: u.id, username: u.username, role: u.role };
}
