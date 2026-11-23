import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_ROLES } from './config/config';
import { configureApp } from './configure-app';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const role = process.env.APP_ROLE;

  if (role === 'api') {
    const app = await NestFactory.create(AppModule);
    configureApp(app);
    app.enableShutdownHooks();
    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port);
    new Logger('Bootstrap').log(`api sluša na :${port}`);
  } else if (role === 'worker') {
    // worker nema http server, samo kontekst sa servisima
    const app = await NestFactory.createApplicationContext(WorkerModule);
    app.enableShutdownHooks();
    new Logger('Bootstrap').log('worker pokrenut');
  } else {
    throw new Error(
      `APP_ROLE mora biti jedan od: ${APP_ROLES.join(' | ')} (dobijeno: ${role ? `"${role}"` : 'nije postavljeno'})`,
    );
  }
}

bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').error(
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
