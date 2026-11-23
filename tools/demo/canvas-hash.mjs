// preuzima GET /api/canvas i ispisuje SHA-256 platna i X-Canvas-Version (pre i posle oporavka Redisa)
//
// upotreba:  node tools/demo/canvas-hash.mjs [BASE_URL]      (podrazumevano http://localhost:8080)
// ako je oporavak u toku (503), čeka po Retry-After do 60 s
import { createHash } from 'node:crypto';

const BASE_URL = (process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
);
const deadline = Date.now() + 60_000;

for (;;) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/canvas`, { headers: { 'Accept-Encoding': 'identity' } });
  } catch (err) {
    if (Date.now() > deadline) throw err;
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  if (res.status === 503 && Date.now() < deadline) {
    const wait = Number(res.headers.get('retry-after') ?? 2) * 1000;
    console.error(`503 (oporavak u toku), ponovo za ${wait} ms...`);
    await new Promise((r) => setTimeout(r, wait));
    continue;
  }
  if (!res.ok) {
    console.error(`GET /api/canvas -> ${res.status}`);
    // bez process.exit(): na Windows-u ruši Node dok su konekcije otvorene
    process.exitCode = 1;
    break;
  }
  const body = Buffer.from(await res.arrayBuffer());
  console.log(`sha256   ${createHash('sha256').update(body).digest('hex')}`);
  console.log(`version  ${res.headers.get('x-canvas-version')}`);
  console.log(
    `size     ${body.length} B (${res.headers.get('x-canvas-width')}x${res.headers.get('x-canvas-height')})`,
  );
  break;
}
