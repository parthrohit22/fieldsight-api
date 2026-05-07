export class AppError extends Error {
  constructor(message, statusCode = 500, code = "APP_ERROR") {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

export function notFoundHandler(req, res, next) {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, "ROUTE_NOT_FOUND"));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = error.statusCode || error.status || 500;
  let code = typeof error.code === "string" ? error.code : "INTERNAL_SERVER_ERROR";
  let message = error.message || "Internal server error";

  if (error.type === "entity.parse.failed") {
    statusCode = 400;
    code = "INVALID_JSON";
    message = "Request body contains invalid JSON";
  }

  if (error.type === "entity.too.large") {
    statusCode = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Request body is too large";
  }

  if (statusCode >= 500) {
    console.error("Request failed", {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code,
      message: error.message,
      stack: error.stack,
    });

    message = "Internal server error";
    code = "INTERNAL_SERVER_ERROR";
  } else {
    console.warn("Request rejected", {
      method: req.method,
      path: req.originalUrl,
      statusCode,
      code,
      message,
    });
  }

  return res.status(statusCode).json({
    error: {
      code,
      message,
    },
  });
}
