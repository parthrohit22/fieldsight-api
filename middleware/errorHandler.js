import appInsights from "applicationinsights";

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

function normalizeStatusCode(error) {
  const statusCode = Number(error.statusCode || error.status || 500);

  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    return statusCode;
  }

  return 500;
}

function trackException(error, req, statusCode, code) {
  try {
    appInsights.defaultClient?.trackException({
      exception: error instanceof Error ? error : new Error(String(error)),
      properties: {
        method: req.method,
        route: req.route?.path ?? req.path,
        path: req.originalUrl,
        statusCode: String(statusCode),
        code,
        isOperational: String(Boolean(error.isOperational)),
      },
    });
  } catch (telemetryError) {
    console.warn("Failed to track exception telemetry", {
      message: telemetryError.message,
    });
  }
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = normalizeStatusCode(error);
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

  trackException(error, req, statusCode, code);

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
