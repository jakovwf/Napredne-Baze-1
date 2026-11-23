import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleGuard, Roles } from './role.guard';
import type { AuthenticatedRequest } from './session.guard';

function ctxFor(req: Partial<AuthenticatedRequest>, handler: object) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('RoleGuard', () => {
  const guard = new RoleGuard(new Reflector());

  class Ctl {
    @Roles('admin')
    adminOnly() {
      return 1;
    }
    open() {
      return 1;
    }
  }
  // metapodaci se čitaju sa funkcije na prototipu, pa se uzima nevezana
  /* eslint-disable @typescript-eslint/unbound-method */
  const adminHandler = Ctl.prototype.adminOnly;
  const openHandler = Ctl.prototype.open;
  /* eslint-enable @typescript-eslint/unbound-method */

  it('bez @Roles propušta', () => {
    expect(guard.canActivate(ctxFor({}, openHandler))).toBe(true);
  });

  it('admin prolazi', () => {
    const req = { user: { id: '1', username: 'a', role: 'admin' } } as never;
    expect(guard.canActivate(ctxFor(req, adminHandler))).toBe(true);
  });

  it('korisnik dobija 403, bez korisnika 401', () => {
    const req = { user: { id: '1', username: 'a', role: 'user' } } as never;
    expect(() => guard.canActivate(ctxFor(req, adminHandler))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(ctxFor({}, adminHandler))).toThrow(
      UnauthorizedException,
    );
  });
});
