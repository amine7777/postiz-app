export function connectLinkTokenPayload(
  orgId: string,
  linkId: string,
  expiresAt: string,
  requestedProvider?: string,
) {
  const provider = requestedProvider?.trim().toLowerCase();
  return {
    orgId,
    linkId,
    ...(provider ? { provider } : {}),
    expiresAt,
  };
}
