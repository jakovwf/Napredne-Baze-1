import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { CanvasService } from './canvas/canvas';
import { AuthStore } from './core/auth/auth.store';
import { credentialsInterceptor } from './core/http/credentials-interceptor';
import { SocketService } from './core/socket/socket';
import { routes } from './app.routes';

/**
 * aplikacija je zoneless (bez Zone.js): detekciju promena pokreću signali i događaji šablona,
 * a socket i rAF događaji visoke frekvencije ne pokreću ništa.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([credentialsInterceptor])),
    // prvo identitet (GET /api/auth/me), pa pretplata platna, pa socket: handshake čita kolačić
    provideAppInitializer(async () => {
      // inject() važi samo pre prvog await-a
      const auth = inject(AuthStore);
      const canvas = inject(CanvasService);
      const socket = inject(SocketService);
      await auth.init();
      canvas.start(); // pretplata na socket događaje pre connect()
      socket.connect();
    }),
  ],
};
