/**
 * Response helpers — eliminate duplicated res.status().json() patterns across routes.
 *
 * sendSuccess(res, data, requestId?)  → 200 { success: true, ...data, requestId? }
 * sendError(res, status, error, extra?, requestId?) → N { success: false, error, ...extra, requestId? }
 */

export function sendSuccess(res, data = {}, requestId) {
  const body = { success: true, ...data };
  if (requestId !== undefined) body.requestId = requestId;
  return res.json(body);
}

export function sendError(res, status, error, extra = {}, requestId) {
  const body = { success: false, error, ...extra };
  if (requestId !== undefined) body.requestId = requestId;
  return res.status(status).json(body);
}
