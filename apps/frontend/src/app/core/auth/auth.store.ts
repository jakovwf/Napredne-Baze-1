import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import type { PublicUser } from '@pixelboard/shared';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { SocketService } from '../socket/socket';
import { authErrorMessage } from './auth-errors';

export type AuthStatus = 'unknown' | 'guest' | 'authenticated';

interface AuthState {
  user: PublicUser | null;
  status: AuthStatus;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = { user: null, status: 'unknown', loading: false, error: null };

/** stanje autentikacije (NgRx SignalStore, piše se ručno jer nema schematic-a) */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, http = inject(HttpClient), socket = inject(SocketService)) => {
    /** vraća true ako je prijava uspela; greška ide u `error` */
    async function login(username: string, password: string): Promise<boolean> {
      patchState(store, { loading: true, error: null });
      try {
        const user = await firstValueFrom(
          http.post<PublicUser>('/api/auth/login', { username, password }),
        );
        patchState(store, { user, status: 'authenticated', loading: false });
        socket.reconnect(); // novi handshake sa kolačićem sesije
        return true;
      } catch (err) {
        patchState(store, { loading: false, error: authErrorMessage(err) });
        return false;
      }
    }

    return {
      /** poziva se pri pokretanju aplikacije; nikad ne baca grešku */
      async init(): Promise<void> {
        try {
          const user = await firstValueFrom(http.get<PublicUser>('/api/auth/me'));
          patchState(store, { user, status: 'authenticated' });
        } catch {
          // 401 je gost; nedostupan server se takođe tretira kao gost
          patchState(store, { user: null, status: 'guest' });
        }
      },

      login,

      /** registracija, pa automatska prijava */
      async register(username: string, password: string): Promise<boolean> {
        patchState(store, { loading: true, error: null });
        try {
          await firstValueFrom(http.post<PublicUser>('/api/auth/register', { username, password }));
        } catch (err) {
          patchState(store, { loading: false, error: authErrorMessage(err) });
          return false;
        }
        return login(username, password);
      },

      async logout(): Promise<void> {
        patchState(store, { loading: true });
        try {
          await firstValueFrom(http.post<void>('/api/auth/logout', {}));
        } catch {
          // 401 znači da je sesija već nevažeća; odjava lokalno ide u svakom slučaju
        }
        patchState(store, { user: null, status: 'guest', loading: false, error: null });
        socket.reconnect();
      },

      /** interceptor: zaštićen poziv je vratio 401, sesija je istekla */
      sessionExpired(): void {
        if (store.status() !== 'authenticated') return;
        patchState(store, { user: null, status: 'guest' });
        socket.reconnect();
      },

      clearError(): void {
        patchState(store, { error: null });
      },
    };
  }),
);
