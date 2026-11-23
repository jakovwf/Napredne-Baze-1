import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { PublicUser } from '@pixelboard/shared';
import type { CookieOptions, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { SESSION_COOKIE } from './cookies';
import { LoginDto, RegisterDto } from './dto';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import {
  type AuthenticatedRequest,
  CurrentUser,
  SessionGuard,
} from './session.guard';
import { toPublicUser } from './user.types';
import { UsersService } from './users.service';

const BAD_CREDENTIALS = 'Pogrešno korisničko ime ili lozinka';

@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.cookieSecure = config.cookieSecure;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.cookieSecure,
      path: '/',
    };
  }

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<PublicUser> {
    const hash = await this.passwords.hash(dto.password);
    const result = await this.users.create(dto.username, hash, 'user');
    if (!result.ok) throw new ConflictException('Korisničko ime je zauzeto');
    return result.user;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const found = await this.users.findByUsername(dto.username);
    // isti 401 za nepostojećeg korisnika i pogrešnu lozinku; za nepostojećeg se
    // proverava lažni hash da vreme odgovora bude slično
    const valid = found
      ? await this.passwords.verify(found.passwordHash, dto.password)
      : await this.passwords.verifyDummy(dto.password);
    if (!found || !valid) throw new UnauthorizedException(BAD_CREDENTIALS);

    const user = toPublicUser(found);
    const sid = await this.sessions.create(user);
    res.cookie(SESSION_COOKIE, sid, {
      ...this.cookieOptions(),
      maxAge: this.sessions.ttlMs,
    });
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.destroy(req.sid!);
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }
}
