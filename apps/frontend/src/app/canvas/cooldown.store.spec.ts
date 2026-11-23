import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CooldownStore } from './cooldown.store';

describe('CooldownStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('startFor aktivira cooldown i gasi ga tačno po isteku', () => {
    const store = TestBed.inject(CooldownStore);
    expect(store.active()).toBe(false);

    store.startFor(5000);
    expect(store.active()).toBe(true);
    expect(store.total()).toBe(5000);
    expect(store.remainingMs()).toBe(5000);

    vi.advanceTimersByTime(4999);
    expect(store.active()).toBe(true);
    expect(store.remainingMs()).toBe(1);

    vi.advanceTimersByTime(1);
    expect(store.active()).toBe(false);
    expect(store.remainingMs()).toBe(0);
  });

  it('novi startFor zamenjuje prethodni tajmer, a nula i clear čiste cooldown', () => {
    const store = TestBed.inject(CooldownStore);
    store.startFor(1000);
    store.startFor(10_000);
    vi.advanceTimersByTime(1000);
    expect(store.active()).toBe(true); // stari tajmer nije ugasio novi cooldown

    store.startFor(0);
    expect(store.active()).toBe(false);
    expect(store.until()).toBe(0);

    store.startFor(1000);
    store.clear();
    expect(store.active()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
