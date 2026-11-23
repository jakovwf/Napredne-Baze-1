import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { PublicUser } from '@pixelboard/shared';
import type { Request } from 'express';
import { SESSION_COOKIE } from './cookies';
import { SessionService } from './session.service';

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
  sid?: string;
}

/** učitava sesiju iz kolačića `sid`; bez važeće sesije vraća 401 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const sid = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE
    ];
    const user = sid ? await this.sessions.get(sid) : null;
    if (!sid || !user) throw new UnauthorizedException('Niste prijavljeni');
    req.user = user;
    req.sid = sid;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
