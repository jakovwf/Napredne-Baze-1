export const SESSION_COOKIE = 'sid';

/** vadi vrednost kolačića iz sirovog `Cookie` zaglavlja (http i websocket handshake) */
export function parseCookie(
  header: string | undefined | null,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part
      .slice(eq + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}
