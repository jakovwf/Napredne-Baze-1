import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { parseCookie } from './cookies';
import { AuthenticatedRequest, SessionGuard } from './session.guard';
import { SessionService } from './session.service';

const ctxFor = (req: Partial<AuthenticatedRequest>) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

describe('SessionGuard', () => {
  const user = { id: '1', username: 'a', role: 'user' as const };
  const sessions = {
    get: jest.fn((sid: string) =>
      Promise.resolve(sid === 'good' ? user : null),
    ),
  } as unknown as SessionService;
  const guard = new SessionGuard(sessions);

  it('postavlja req.user za važeću sesiju', async () => {
    const req: Partial<AuthenticatedRequest> = { cookies: { sid: 'good' } };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.user).toEqual(user);
  });

  it('401 bez kolačića i za nepoznat sid', async () => {
    await expect(guard.canActivate(ctxFor({ cookies: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(ctxFor({ cookies: { sid: 'bad' } })),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('parseCookie', () => {
  it('nalazi kolačić među više i dekodira vrednost', () => {
    expect(parseCookie('a=1; sid=abc_DEF-9; b=2', 'sid')).toBe('abc_DEF-9');
    expect(parseCookie('sid="a%20b"', 'sid')).toBe('a b');
  });

  it('vraća null kad nema kolačića, za sufiks imena i loše kodiranje', () => {
    expect(parseCookie('a=1', 'sid')).toBeNull();
    expect(parseCookie(undefined, 'sid')).toBeNull();
    expect(parseCookie('xsid=1', 'sid')).toBeNull();
    expect(parseCookie('sid=%E0%A4%A', 'sid')).toBeNull();
  });
});
