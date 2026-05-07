import crypto from "crypto";

import config from "../config/env.js";
import { AppError } from "./errorHandler.js";

function hash(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function secureCompare(providedKey, expectedKey) {
  return crypto.timingSafeEqual(hash(providedKey), hash(expectedKey));
}

export function authenticateApiKey(req, res, next) {
  const providedKey = req.get("x-api-key");

  if (!providedKey || !secureCompare(providedKey, config.apiKey)) {
    return next(new AppError("Invalid or missing API key", 401, "UNAUTHORIZED"));
  }

  return next();
}
