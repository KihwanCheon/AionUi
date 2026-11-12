import { describe, expect, it } from 'vitest';
import {
  normalizeMindNProgressApiUrl,
  normalizeRunnerCredential,
} from '@/process/startup/bootstrap/mindnprogressRunner/credential';

describe('MindNProgress Runner credential', () => {
  it('keeps only the server origin and normalizes the machine id', () => {
    expect(
      normalizeRunnerCredential({
        apiUrl: 'https://mnp.example.test/some/path?secret=no',
        machineId: 'MACBOOK',
        label: 'My Mac',
        token: 'mnprn_secret',
      })
    ).toEqual({
      apiUrl: 'https://mnp.example.test',
      machineId: 'macbook',
      label: 'My Mac',
      token: 'mnprn_secret',
    });
  });

  it('rejects credentials embedded in the URL', () => {
    expect(() => normalizeMindNProgressApiUrl('https://user:password@mnp.example.test')).toThrow(
      'must not contain credentials'
    );
  });

  it('rejects malformed machine credentials', () => {
    expect(() =>
      normalizeRunnerCredential({
        apiUrl: 'https://mnp.example.test',
        machineId: '../other',
        label: 'Other',
        token: 'plain-token',
      })
    ).toThrow('Runner credential is invalid.');
  });
});
