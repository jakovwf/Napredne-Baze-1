import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hash je argon2id i verify razlikuje tačnu od pogrešne lozinke', async () => {
    const hash = await svc.hash('tajna-lozinka');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('tajna-lozinka');
    expect(await svc.verify(hash, 'tajna-lozinka')).toBe(true);
    expect(await svc.verify(hash, 'pogresna')).toBe(false);
  });

  it('dva hash-a iste lozinke se razlikuju (salt)', async () => {
    expect(await svc.hash('abcdefgh')).not.toBe(await svc.hash('abcdefgh'));
  });

  it('neispravan hash daje false, ne izuzetak', async () => {
    expect(await svc.verify('nije-hash', 'x')).toBe(false);
  });
});
