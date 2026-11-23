import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PasswordService } from './password.service';
import { UsersService } from './users.service';

/** upisuje prvog admina iz ADMIN_USERNAME i ADMIN_PASSWORD; ponovni start ne pravi duplikat */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminSeed');

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { username, password } = this.config.admin;
    const existing = await this.users.findByUsername(username);
    if (existing) {
      this.report(username, existing.role);
      return;
    }

    const hash = await this.passwords.hash(password);
    const result = await this.users.create(username, hash, 'admin');
    if (result.ok) {
      this.logger.log(`admin "${username}" napravljen`);
    } else {
      // druga api instanca je pobedila u trci (lwt)
      const now = await this.users.findByUsername(username);
      this.report(username, now?.role);
    }
  }

  private report(username: string, role?: string) {
    if (role === 'admin') {
      this.logger.log(`admin "${username}" već postoji`);
    } else {
      this.logger.warn(
        `korisnik "${username}" postoji sa ulogom "${role}", ne admin; seed preskočen`,
      );
    }
  }
}
