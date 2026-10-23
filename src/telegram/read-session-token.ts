const firstHeader = (
  value: string | string[] | undefined,
): string => String(Array.isArray(value) ? value[0] : value ?? '').trim();

/** Session token from custom header, Authorization Bearer, or JSON body. */
export const readSessionTokenFromRequest = (
  headers: Record<string, string | string[] | undefined>,
  body?: Record<string, unknown> | { app_session_token?: string | null },
): string => {
  const fromHeader = firstHeader(headers['x-app-session-token']);
  if (fromHeader) return fromHeader;

  const authorization = firstHeader(headers['authorization']);
  const bearer = /^Bearer\s+(\S+)/i.exec(authorization);
  if (bearer?.[1]) return bearer[1].trim();

  const fromBody = body?.app_session_token;
  return typeof fromBody === 'string' ? fromBody.trim() : '';
};
