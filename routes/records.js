import express from "express";
import appInsights from "applicationinsights";
import { v4 as uuidv4 } from "uuid";

import config from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { deleteBlob, uploadBlob } from "../services/blobService.js";
import {
  createRecord,
  deleteRecord,
  findRecordById,
  getAllRecords,
  getRecord,
  updateRecord,
} from "../services/cosmosService.js";

const router = express.Router();
const VALID_CATEGORIES = new Set(["Flora", "Fauna", "Fungi", "Habitat"]);

function requireBodyObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("Request body must be a JSON object", 400, "INVALID_BODY");
  }
}

function requireString(body, fieldName) {
  const value = body[fieldName];

  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(`${fieldName} is required and must be a non-empty string`, 400, "INVALID_BODY");
  }

  return value.trim();
}

function validateCategory(category) {
  if (!VALID_CATEGORIES.has(category)) {
    throw new AppError(
      "category must be one of: Flora, Fauna, Fungi, Habitat",
      400,
      "INVALID_CATEGORY",
    );
  }

  return category;
}

function requireCategory(body) {
  return validateCategory(requireString(body, "category"));
}

function rejectUnsupportedFields(body, allowedFields) {
  const unsupportedFields = Object.keys(body).filter((field) => !allowedFields.includes(field));

  if (unsupportedFields.length) {
    throw new AppError(
      `Unsupported field(s): ${unsupportedFields.join(", ")}`,
      400,
      "UNSUPPORTED_FIELDS",
    );
  }
}

function optionalQueryString(query, fieldName) {
  const value = query[fieldName];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(`${fieldName} must be a non-empty string`, 400, "INVALID_QUERY");
  }

  return value.trim();
}

function optionalCategoryQuery(query) {
  const category = optionalQueryString(query, "category");
  return category === undefined ? undefined : validateCategory(category);
}

function parseIntegerQuery(query, fieldName, { defaultValue, min, max }) {
  const rawValue = query[fieldName];

  if (rawValue === undefined) {
    return defaultValue;
  }

  if (Array.isArray(rawValue) || typeof rawValue !== "string") {
    throw new AppError(`${fieldName} must be a single integer`, 400, "INVALID_PAGINATION");
  }

  const trimmedValue = rawValue.trim();

  if (!/^(0|[1-9]\d*)$/.test(trimmedValue)) {
    throw new AppError(`${fieldName} must be an integer`, 400, "INVALID_PAGINATION");
  }

  const value = Number(trimmedValue);

  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    const range = max === undefined
      ? `greater than or equal to ${min}`
      : `between ${min} and ${max}`;

    throw new AppError(`${fieldName} must be an integer ${range}`, 400, "INVALID_PAGINATION");
  }

  return value;
}

function parsePaginationQuery(query) {
  const limit = parseIntegerQuery(query, "limit", {
    defaultValue: 20,
    min: 1,
    max: 100,
  });
  const offset = parseIntegerQuery(query, "offset", {
    defaultValue: 0,
    min: 0,
  });

  return { limit, offset };
}

function trackUploadAttempt(projectID, category) {
  try {
    appInsights.defaultClient?.trackEvent({
      name: "UploadAttempt",
      properties: {
        projectID,
        category,
      },
    });
  } catch (error) {
    console.warn("Failed to track UploadAttempt telemetry", {
      message: error.message,
    });
  }
}

async function requireExistingRecord(operation) {
  try {
    const record = await operation();

    if (!record) {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }

    return record;
  } catch (error) {
    if (error.statusCode === 404 || error.code === "RECORD_NOT_FOUND") {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }

    throw error;
  }
}

function buildBlobUrl(blobPath) {
  if (!blobPath) return null;

  const normalized = blobPath.startsWith("/")
    ? blobPath.slice(1)
    : blobPath;

  return `https://${config.storage.accountName}.blob.core.windows.net/${config.storage.containerName}/${normalized}`;
}

function formatRecordResponse(record) {
  return {
    id: record.id,
    projectID: record.projectID,
    category: record.category,
    researcherID: record.researcherID,
    captureTimestamp: record.captureTimestamp,
    file: {
      name: record.file?.name ?? null,
      blobUrl: buildBlobUrl(record.file?.blobPath),
    },
  };
}

router.post("/upload", async (req, res, next) => {
  let file;

  try {
    requireBodyObject(req.body);

    const projectID = requireString(req.body, "projectID");
    const category = requireString(req.body, "category");
    const researcherID = requireString(req.body, "researcherID");
    const captureTimestamp = requireString(req.body, "captureTimestamp");
    const fileName = requireString(req.body, "fileName");
    const fileContent = requireString(req.body, "fileContent");

    trackUploadAttempt(projectID, category);
    validateCategory(category);

    const id = uuidv4();
    file = await uploadBlob({ id, fileName, fileContent });

    const record = {
      id,
      projectID,
      researcherID,
      category,
      captureTimestamp,
      file,
    };

    const createdRecord = await createRecord(record);
    return res.status(201).json({
      success: true,
      data: formatRecordResponse(createdRecord),
    });
  } catch (error) {
    if (file?.blobPath) {
      await deleteBlob(file.blobPath).catch((cleanupError) => {
        console.error("Failed to clean up blob after upload failure", {
          blobPath: file.blobPath,
          message: cleanupError.message,
        });
      });
    }

    return next(error);
  }
});

router.get("/records", async (req, res, next) => {
  try {
    const filters = {
      projectID: optionalQueryString(req.query, "projectID"),
      category: optionalCategoryQuery(req.query),
      researcherID: optionalQueryString(req.query, "researcherID"),
    };
    const pagination = parsePaginationQuery(req.query);
    const { resources, total } = await getAllRecords(filters, pagination);
    const data = resources.map(formatRecordResponse);

    return res.status(200).json({
      success: true,
      total,
      count: data.length,
      limit: pagination.limit,
      offset: pagination.offset,
      data,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/records/:id", async (req, res, next) => {
  try {
    requireBodyObject(req.body);

    const id = req.params.id;
    const projectID = requireString(req.body, "projectID");
    const researcherID = requireString(req.body, "researcherID");
    const record = await requireExistingRecord(() => getRecord(id, projectID));

    if (record.researcherID !== researcherID) {
      throw new AppError("Forbidden", 403);
    }

    await deleteBlob(record.file?.blobPath);
    await deleteRecord(id, projectID);

    return res.status(200).json({
      success: true,
      message: "Record deleted",
    });
  } catch (error) {
    return next(error);
  }
});

router.put("/records/:id", async (req, res, next) => {
  try {
    requireBodyObject(req.body);
    rejectUnsupportedFields(req.body, ["category", "projectID", "researcherID"]);

    const researcherID = requireString(req.body, "researcherID");
    const existingRecord = await requireExistingRecord(() => findRecordById(req.params.id));

    if (existingRecord.researcherID !== researcherID) {
      throw new AppError("Forbidden", 403);
    }

    const updates = {};

    if (Object.hasOwn(req.body, "category")) {
      updates.category = requireCategory(req.body);
    }

    if (Object.hasOwn(req.body, "projectID")) {
      updates.projectID = requireString(req.body, "projectID");
    }

    if (!Object.keys(updates).length) {
      throw new AppError("At least one update field is required", 400, "INVALID_BODY");
    }

    const updatedRecord = await updateRecord(req.params.id, updates);
    return res.status(200).json({
      success: true,
      data: formatRecordResponse(updatedRecord),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
