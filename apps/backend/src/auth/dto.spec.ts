import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto, RegisterDto } from './dto';

// isto podešavanje kao globalni ValidationPipe
const check = (cls: new () => object, obj: object) =>
  validate(plainToInstance(cls, obj), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('RegisterDto', () => {
  const ok = { username: 'Pixel_1', password: 'abcdefgh' };

  it('prihvata validne podatke', async () => {
    expect(await check(RegisterDto, ok)).toHaveLength(0);
  });

  it.each(['ab', 'a'.repeat(21), 'bad name', 'čćž1', 'a-b-c'])(
    'odbija korisničko ime "%s"',
    async (username) => {
      expect((await check(RegisterDto, { ...ok, username })).length).toBe(1);
    },
  );

  it.each(['short', 'x'.repeat(129)])('odbija lozinku %#', async (password) => {
    expect((await check(RegisterDto, { ...ok, password })).length).toBe(1);
  });

  it('odbija nepoznato polje', async () => {
    expect((await check(RegisterDto, { ...ok, role: 'admin' })).length).toBe(1);
  });
});

describe('LoginDto', () => {
  it('odbija prazno korisničko ime i predugačku lozinku', async () => {
    expect(
      await check(LoginDto, { username: 'a', password: 'b' }),
    ).toHaveLength(0);
    expect(
      (await check(LoginDto, { username: '', password: 'b' })).length,
    ).toBe(1);
    expect(
      (await check(LoginDto, { username: 'a', password: 'x'.repeat(129) }))
        .length,
    ).toBe(1);
  });
});
