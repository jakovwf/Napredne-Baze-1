import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

interface CooldownState {
  /** kraj cooldown-a (epoch ms, po satu klijenta) */
  until: number;
  /** trajanje trenutnog cooldown-a (za prikaz napretka) */
  total: number;
  active: boolean;
}

/**
 * cooldown posle poteza. trajanje (`ms`) dolazi sa servera (`cooldownMs` iz ack-a ili `retryInMs`
 * iz greške), a kraj se računa po satu klijenta, pa razlika u satovima ne utiče na odbrojavanje.
 *
 * store drži samo `until` i `active`: jedan setTimeout prebacuje `active` na false pri isteku.
 * odbrojavanje za prikaz radi komponenta CooldownBadge.
 */
export const CooldownStore = signalStore(
  { providedIn: 'root' },
  withState<CooldownState>({ until: 0, total: 0, active: false }),
  withMethods((store) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function clear(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
      patchState(store, { until: 0, total: 0, active: false });
    }

    return {
      startFor(ms: number): void {
        if (timer) clearTimeout(timer);
        if (!(ms > 0)) return clear();
        patchState(store, { until: Date.now() + ms, total: ms, active: true });
        timer = setTimeout(() => {
          timer = undefined;
          patchState(store, { active: false });
        }, ms);
      },
      remainingMs(): number {
        return Math.max(0, store.until() - Date.now());
      },
      clear,
    };
  }),
);
