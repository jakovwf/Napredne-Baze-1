import { Injectable } from '@nestjs/common';
import type { Role } from '@pixelboard/shared';
import { types } from 'cassandra-driver';
import { CassandraService } from '../cassandra/cassandra.service';
import { CreateUserResult, UserCredentials, toPublicUser } from './user.types';

/** pristup tabeli users_by_username */
@Injectable()
export class UsersService {
  constructor(private readonly db: CassandraService) {}

  /** registracija; jedinstvenost garantuje LWT (`IF NOT EXISTS`) */
  async create(
    username: string,
    passwordHash: string,
    role: Role,
  ): Promise<CreateUserResult> {
    const id = types.Uuid.random();

    // lwt: upis samo ako username ne postoji, inače se vraća postojeći red
    const result = await this.db.execute(
      `INSERT INTO users_by_username
         (username_lower, user_id, username, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?) IF NOT EXISTS`,
      [username.toLowerCase(), id, username, passwordHash, role, new Date()],
    );
    if (!result.wasApplied()) return { ok: false, reason: 'taken' };
    return {
      ok: true,
      user: toPublicUser({ id: id.toString(), username, role }),
    };
  }

  async findByUsername(username: string): Promise<UserCredentials | null> {
    // čitanje po ključu particije
    const res = await this.db.execute(
      `SELECT user_id, username, password_hash, role, created_at
         FROM users_by_username WHERE username_lower = ?`,
      [username.toLowerCase()],
    );
    const row = res.first();
    if (!row) return null;
    return {
      id: (row['user_id'] as types.Uuid).toString(),
      username: row['username'] as string,
      passwordHash: row['password_hash'] as string,
      role: row['role'] as Role,
      createdAt: row['created_at'] as Date,
    };
  }
}
