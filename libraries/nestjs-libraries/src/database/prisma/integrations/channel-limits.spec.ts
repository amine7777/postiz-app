/** @jest-environment node */
import { describe, expect, it, jest } from '@jest/globals';
import {
  assertWithinChannelLimit,
  channelLimitFor,
  parseChannelLimits,
} from './channel-limits';

const allowed = ['youtube', 'x', 'facebook'];

describe('parseChannelLimits', () => {
  it('accepts integers per allowed provider and null', () => {
    expect(parseChannelLimits({ youtube: 2, x: 0 }, allowed)).toEqual({
      youtube: 2,
      x: 0,
    });
    expect(parseChannelLimits({}, allowed)).toEqual({});
    expect(parseChannelLimits(null, allowed)).toBeNull();
  });

  it.each([
    [[1], 'must be an object or null'],
    ['2', 'must be an object or null'],
    [{ myspace: 1 }, 'Unknown provider'],
    [{ youtube: -1 }, 'integer from 0'],
    [{ youtube: 1.5 }, 'integer from 0'],
    [{ youtube: '2' }, 'integer from 0'],
    [{ youtube: 10001 }, 'integer from 0'],
  ])('refuses %j', (value, message) => {
    expect(() => parseChannelLimits(value, allowed)).toThrow(message);
  });
});

describe('channelLimitFor', () => {
  it('reads one provider and ignores anything else', () => {
    expect(channelLimitFor({ youtube: 2 }, 'youtube')).toBe(2);
    expect(channelLimitFor({ youtube: 0 }, 'youtube')).toBe(0);
    expect(channelLimitFor({ youtube: 2 }, 'x')).toBeUndefined();
    expect(channelLimitFor(null, 'x')).toBeUndefined();
    expect(channelLimitFor({ x: 'bad' }, 'x')).toBeUndefined();
  });
});

describe('assertWithinChannelLimit', () => {
  const db = (limits: unknown, current: any, active: number) => ({
    organization: { findUnique: jest.fn(async () => ({ channelLimits: limits })) },
    integration: {
      findUnique: jest.fn(async () => current),
      count: jest.fn(async () => active),
    },
  });
  const live = { deletedAt: null, disabled: false, inBetweenSteps: false };

  it('does nothing more than read the org when no limit applies', async () => {
    for (const limits of [null, {}, { x: 1 }]) {
      const fake = db(limits, null, 99);
      await expect(
        assertWithinChannelLimit(fake, 'org', 'youtube', 'id', false)
      ).resolves.toBeUndefined();
      expect(fake.integration.findUnique).not.toHaveBeenCalled();
      expect(fake.integration.count).not.toHaveBeenCalled();
    }
  });

  it('refuses a new channel at the limit with CHANNEL_LIMIT', async () => {
    const fake = db({ youtube: 1 }, null, 1);
    await expect(
      assertWithinChannelLimit(fake, 'org', 'youtube', 'new', false)
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'CHANNEL_LIMIT', provider: 'youtube', limit: 1 },
    });
    expect(fake.integration.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org',
        providerIdentifier: 'youtube',
        deletedAt: null,
        inBetweenSteps: false,
        disabled: false,
      },
    });
  });

  it('allows a new channel under the limit, and a limit of 0 blocks all', async () => {
    await expect(
      assertWithinChannelLimit(db({ youtube: 2 }, null, 1), 'org', 'youtube', 'n', false)
    ).resolves.toBeUndefined();
    await expect(
      assertWithinChannelLimit(db({ youtube: 0 }, null, 0), 'org', 'youtube', 'n', false)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('lets an active channel reconnect or refresh at the limit', async () => {
    await expect(
      assertWithinChannelLimit(db({ youtube: 1 }, live, 1), 'org', 'youtube', 'a', false)
    ).resolves.toBeUndefined();
  });

  it('counts a deleted, pending or (when enabling) disabled channel as new', async () => {
    for (const [current, enables] of [
      [{ ...live, deletedAt: new Date() }, false],
      [{ ...live, inBetweenSteps: true }, false],
      [{ ...live, disabled: true }, true],
    ] as const) {
      await expect(
        assertWithinChannelLimit(db({ youtube: 1 }, current, 1), 'org', 'youtube', 'a', enables)
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it('lets a disabled channel refresh its token when the write keeps it disabled', async () => {
    await expect(
      assertWithinChannelLimit(
        db({ youtube: 1 }, { ...live, disabled: true }, 1),
        'org',
        'youtube',
        'a',
        false
      )
    ).resolves.toBeUndefined();
  });
});
