import { InvalidMoveError, parseMove, parseStreamId } from './move-record';

const limits = { width: 300, height: 300, colors: 32 };
const UID = '0b0e5d28-3c0a-4f0f-8d63-0d6a3f3c9a11';
const fields = (o: Record<string, string>) => Object.entries(o).flat();

describe('parseStreamId', () => {
  it('rastavlja ID na timestamp i seq', () => {
    const { placedAt, seq } = parseStreamId('1700000000123-7');
    expect(placedAt.getTime()).toBe(1700000000123);
    expect(seq).toBe(7);
  });

  it.each(['abc', '123', '123-', '-1', '1-2-3', '1-99999999999'])(
    'odbija "%s"',
    (id) => {
      expect(() => parseStreamId(id)).toThrow(InvalidMoveError);
    },
  );
});

describe('parseMove', () => {
  const ok = fields({ uid: UID, u: 'Pera', x: '123', y: '256', c: '17' });

  it('izvodi bucket, dan, sat i ćeliju heatmape (UTC)', () => {
    // 2005-03-04T23:59:58.500Z
    const ms = Date.UTC(2005, 2, 4, 23, 59, 58, 500);
    const m = parseMove(`${ms}-3`, ok, limits);
    expect(m).toMatchObject({
      seq: 3,
      uid: UID,
      username: 'Pera',
      x: 123,
      y: 256,
      color: 17,
      bucket: '2005030423',
      day: '2005-03-04',
      hour: 23,
      cellX: 12,
      cellY: 25,
    });
    expect(m.placedAt.getTime()).toBe(ms);
  });

  it.each([
    ['nedostaje uid', { u: 'a', x: '1', y: '1', c: '1' }],
    ['uid nije uuid', { uid: 'x', u: 'a', x: '1', y: '1', c: '1' }],
    ['x nije broj', { uid: UID, u: 'a', x: 'abc', y: '1', c: '1' }],
    ['negativan y', { uid: UID, u: 'a', x: '1', y: '-1', c: '1' }],
    ['x van platna', { uid: UID, u: 'a', x: '300', y: '1', c: '1' }],
    ['boja van palete', { uid: UID, u: 'a', x: '1', y: '1', c: '32' }],
    ['nedostaje c', { uid: UID, u: 'a', x: '1', y: '1' }],
  ])('odbija: %s', (_name, f) => {
    expect(() => parseMove('1000-0', fields(f), limits)).toThrow(
      InvalidMoveError,
    );
  });
});
