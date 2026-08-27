import {
  lastCaptureBefore,
  timestampToDate,
} from '../wayback-availability.service';

/**
 * The leak guard of plan 024, tested at the rule that carries it: a capture taken at or after a
 * deadline encodes what the matches revealed, and must never be the one ingested. These tests are
 * the break-on-purpose for that rule (`fpl-testing-contract`) — remove the strict inequality in
 * `lastCaptureBefore` and the exact-deadline case below goes red.
 */
describe('lastCaptureBefore', () => {
  const deadline = new Date('2024-12-07T13:30:00Z');

  it('picks the latest capture strictly before the deadline', () => {
    expect(
      lastCaptureBefore(
        ['20241205000000', '20241206221500', '20241207140000'],
        deadline,
      ),
    ).toBe('20241206221500');
  });

  it('rejects a capture at the deadline second — post-lock, untrusted', () => {
    expect(lastCaptureBefore(['20241207133000'], deadline)).toBeNull();
  });

  it('rejects captures after the deadline even when nothing else exists', () => {
    // The tempting bug: "nearest capture" instead of "last before". The morning-after snapshot is
    // the nearest one for a Friday deadline, and it knows who got injured in the match.
    expect(lastCaptureBefore(['20241207220000'], deadline)).toBeNull();
  });

  it('one second before the deadline is eligible', () => {
    expect(lastCaptureBefore(['20241207132959'], deadline)).toBe(
      '20241207132959',
    );
  });
});

describe('timestampToDate', () => {
  it('parses the 14-digit Wayback timestamp as UTC', () => {
    expect(timestampToDate('20241206221530').toISOString()).toBe(
      '2024-12-06T22:15:30.000Z',
    );
  });
});
