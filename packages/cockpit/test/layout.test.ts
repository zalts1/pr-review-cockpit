// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { layoutKey, otherLayout, readLayout, writeLayout } from '../src/lib/layout';

afterEach(() => {
  localStorage.clear();
});

describe('readLayout', () => {
  it('is the rail until the reviewer picks the column', () => {
    expect(readLayout()).toBe('rail');
  });

  it('reads back the column and forgets it again for the rail', () => {
    writeLayout('column');
    expect(localStorage.getItem(layoutKey)).toBe('column');
    expect(readLayout()).toBe('column');
    writeLayout('rail');
    expect(localStorage.getItem(layoutKey)).toBeNull();
    expect(readLayout()).toBe('rail');
  });

  it('drops a stored value it does not recognise', () => {
    localStorage.setItem(layoutKey, 'inspector');
    expect(readLayout()).toBe('rail');
  });
});

describe('otherLayout', () => {
  it('flips between the two', () => {
    expect(otherLayout('rail')).toBe('column');
    expect(otherLayout('column')).toBe('rail');
  });
});
