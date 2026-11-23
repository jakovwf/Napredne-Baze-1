import type { PixelPlaceError } from '@pixelboard/shared';

export type PlaceFailure = PixelPlaceError | 'NETWORK';

/** poruke (srpski) za greške bojenja */
export function placeErrorMessage(error: PlaceFailure, retryInMs?: number): string {
  switch (error) {
    case 'COOLDOWN':
      return retryInMs
        ? `Još malo strpljenja, sledeći piksel za ${Math.ceil(retryInMs / 1000)} s.`
        : 'Još malo strpljenja, cooldown je u toku.';
    case 'ZONE_LOCKED':
      return 'Ovaj deo platna je zaključan.';
    case 'UNAUTHORIZED':
      return 'Prijavi se da bi bojio.';
    case 'NOT_READY':
      return 'Platno se vraća, sačekaj trenutak.';
    case 'INVALID_COORDS':
    case 'INVALID_COLOR':
    case 'INVALID_PAYLOAD':
      return 'Neispravan potez.';
    case 'NETWORK':
      return 'Nema veze sa serverom, potez nije poslat.';
  }
}
