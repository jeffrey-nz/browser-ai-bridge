import { logger } from "#utils/logger.js";

export function globalErrorHandler(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) logger.error(err, "[Server Error]");
  else logger.warn(`[Client Error] ${status} ${err.message}`);
  res.status(status).json({
    success: false,
    error: status >= 500 ? "Internal Server Error" : err.message,
    message: err.message,
  });
}
