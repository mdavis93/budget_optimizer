import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../../electron/utils/escapeHtml';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
  });

  it('escapes ampersands and quotes', () => {
    expect(escapeHtml(`Tom & Jerry "quoted" 'single'`)).toBe(
      'Tom &amp; Jerry &quot;quoted&quot; &#39;single&#39;'
    );
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Rent Payment')).toBe('Rent Payment');
  });
});
