export function connectLinkTokenPayload(
  orgId: string,
  linkId: string,
  expiresAt: string,
  requestedProvider?: string,
  refresh?: string,
) {
  const provider = requestedProvider?.trim().toLowerCase();
  return {
    orgId,
    linkId,
    ...(provider ? { provider } : {}),
    // The channel's internalId: the OAuth callback must match it.
    ...(refresh ? { refresh } : {}),
    expiresAt,
  };
}
