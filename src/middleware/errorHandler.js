import { logger } from "#utils/logger.js";

export function globalErrorHandler(err, req, res, next) {
  logger.error(err, "[Server Error]");
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message: err.message,
  });
}
