import { HttpException, HttpStatus } from '@nestjs/common';

/** Max active channels per provider identifier, e.g. { youtube: 2, x: 1 }. */
export type ChannelLimits = Record<string, number>;

export const MAX_CHANNEL_LIMIT = 10000;

/**
 * Validates an admin-supplied limits object. `null` clears every limit.
 * Throws an Error with a readable message on bad input.
 */
export function parseChannelLimits(
  value: unknown,
  allowedProviders: string[]
): ChannelLimits | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('channelLimits must be an object or null');
  }
  const limits: ChannelLimits = {};
  for (const [provider, limit] of Object.entries(value as object)) {
    if (!allowedProviders.includes(provider)) {
      throw new Error(`Unknown provider in channelLimits: ${provider}`);
    }
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_CHANNEL_LIMIT) {
      throw new Error(
        `channelLimits.${provider} must be an integer from 0 to ${MAX_CHANNEL_LIMIT}`
      );
    }
    limits[provider] = limit;
  }
  return limits;
}

/** The limit for one provider, or undefined when the org has none for it. */
export function channelLimitFor(
  limits: unknown,
  provider: string
): number | undefined {
  if (!limits || typeof limits !== 'object') return undefined;
  const limit = (limits as Record<string, unknown>)[provider];
  return Number.isInteger(limit) && (limit as number) >= 0
    ? (limit as number)
    : undefined;
}

export class ChannelLimitReached extends HttpException {
  constructor(provider: string, limit: number) {
    super(
      {
        code: 'CHANNEL_LIMIT',
        provider,
        limit,
        msg: `This organization can connect at most ${limit} ${provider} channel(s)`,
      },
      HttpStatus.FORBIDDEN
    );
  }
}

type ChannelLimitDb = {
  organization: {
    findUnique(args: any): Promise<{ channelLimits: unknown } | null>;
  };
  integration: {
    findUnique(args: any): Promise<{
      deletedAt: Date | null;
      disabled: boolean;
      inBetweenSteps: boolean;
    } | null>;
    count(args: any): Promise<number>;
  };
};

/**
 * Throws ChannelLimitReached when writing (org, internalId) would add an active
 * channel of `provider` beyond the org's limit. No limit for the provider: no-op.
 *
 * `enables`: the write also clears `disabled` (page selection, enable route),
 * so an existing disabled channel counts as new.
 */
export async function assertWithinChannelLimit(
  db: ChannelLimitDb,
  org: string,
  provider: string,
  internalId: string,
  enables: boolean
) {
  const found = await db.organization.findUnique({
    where: { id: org },
    select: { channelLimits: true },
  });
  const limit = channelLimitFor(found?.channelLimits, provider);
  if (limit === undefined) return;

  const current = await db.integration.findUnique({
    where: { organizationId_internalId: { organizationId: org, internalId } },
    select: { deletedAt: true, disabled: true, inBetweenSteps: true },
  });
  // Already active, or stays disabled: the write adds no active channel.
  const addsNoChannel =
    current &&
    !current.deletedAt &&
    !current.inBetweenSteps &&
    (!enables || !current.disabled);
  if (addsNoChannel) return;

  const active = await db.integration.count({
    where: {
      organizationId: org,
      providerIdentifier: provider,
      deletedAt: null,
      inBetweenSteps: false,
      disabled: false,
    },
  });
  if (active >= limit) {
    throw new ChannelLimitReached(provider, limit);
  }
}
