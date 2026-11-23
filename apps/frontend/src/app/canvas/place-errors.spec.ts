import { placeErrorMessage } from './place-errors';

describe('placeErrorMessage', () => {
  it('COOLDOWN prikazuje preostalo vreme, ostale greške imaju poruku na srpskom', () => {
    expect(placeErrorMessage('COOLDOWN', 2300)).toContain('3 s');
    expect(placeErrorMessage('ZONE_LOCKED')).toContain('zaključan');
    expect(placeErrorMessage('UNAUTHORIZED')).toContain('Prijavi se');
    expect(placeErrorMessage('NOT_READY')).toContain('vraća');
    expect(placeErrorMessage('NETWORK')).toContain('veze');
  });
});
