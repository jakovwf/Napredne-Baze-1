/** tipovi Socket.IO događaja; isti fajl koriste front i bek */

/**
 * status platna. kad status pređe iz `recovering` u `ready` (oporavak posle gubitka Redisa),
 * klijent MORA ponovo da preuzme celo platno (`GET /api/canvas`) i da odbaci bafer. verzija
 * posle oporavka može da bude MANJA nego pre pada (potezi koji nisu stigli u Cassandru su
 * izgubljeni), pa filtriranje `version <= X-Canvas-Version` ne sme da se oslanja na staru verziju.
 */
export type CanvasStatus = "ready" | "recovering";
export type ZoneReleaseReason = "expired" | "admin";

export interface PixelPlacePayload {
  x: number;
  y: number;
  color: number;
}

export type PixelPlaceError =
  | "UNAUTHORIZED"
  | "INVALID_PAYLOAD"
  | "INVALID_COORDS"
  | "INVALID_COLOR"
  | "NOT_READY"
  | "COOLDOWN"
  | "ZONE_LOCKED";

export type PixelPlaceAck =
  | { ok: true; cooldownMs: number }
  | {
      ok: false;
      error: PixelPlaceError;
      retryInMs?: number;
      lockId?: string;
    };

/** batch promena: `v[i]` je verzija platna za `p[i] = [x, y, color]` */
export interface PixelBatchPayload {
  v: number[];
  p: [number, number, number][];
}

export interface CanvasStatusPayload {
  status: CanvasStatus;
}

export interface ZoneLockedPayload {
  lockId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ownerName: string;
  expiresAt: number;
}

export interface ZoneReleasedPayload {
  lockId: string;
  reason: ZoneReleaseReason;
}

export interface ChatSendPayload {
  text: string;
}

export type ChatSendAck = { ok: true } | { ok: false; error: string };

export interface ChatMessagePayload {
  id: string;
  uid: string;
  username: string;
  text: string;
  ts: number;
}

export interface PresenceCountPayload {
  online: number;
}

/** klijent → server */
export interface ClientToServerEvents {
  "pixel:place": (
    payload: PixelPlacePayload,
    ack: (res: PixelPlaceAck) => void,
  ) => void;
  "chat:send": (
    payload: ChatSendPayload,
    ack: (res: ChatSendAck) => void,
  ) => void;
  "presence:heartbeat": () => void;
}

/** server → klijent */
export interface ServerToClientEvents {
  "pixel:batch": (payload: PixelBatchPayload) => void;
  "canvas:status": (payload: CanvasStatusPayload) => void;
  "zone:locked": (payload: ZoneLockedPayload) => void;
  "zone:released": (payload: ZoneReleasedPayload) => void;
  "chat:message": (payload: ChatMessagePayload) => void;
  "presence:count": (payload: PresenceCountPayload) => void;
}
