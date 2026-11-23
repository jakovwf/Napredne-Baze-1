import { Module } from '@nestjs/common';
import { AdminSeedService } from './admin-seed.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { RoleGuard } from './role.guard';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    SessionService,
    UsersService,
    AdminSeedService,
    SessionGuard,
    RoleGuard,
  ],
  exports: [SessionService, SessionGuard, RoleGuard, UsersService],
})
export class AuthModule {}
