import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  /** lažni hash za prijavu nepostojećeg korisnika (izjednačava vreme odgovora) */
  private dummyHash?: Promise<string>;

  /** argon2id sa podrazumevanim parametrima biblioteke; salt je nasumičan i u hash-u */
  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false; // neispravan format hash-a je neuspeh, ne greška servera
    }
  }

  /** proverava lozinku nad lažnim hash-om; uvek vraća false */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
