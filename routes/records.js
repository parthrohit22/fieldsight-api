import express from "express";
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

function parsePaginationQuery(query) {
  const limitRaw = query.limit ?? "20";
  const offsetRaw = query.offset ?? "0";

  if (Array.isArray(limitRaw) || !/^\d+$/.test(String(limitRaw))) {
    throw new AppError("limit must be an integer between 1 and 100", 400, "INVALID_PAGINATION");
  }

  if (Array.isArray(offsetRaw) || !/^\d+$/.test(String(offsetRaw))) {
    throw new AppError("offset must be an integer greater than or equal to 0", 400, "INVALID_PAGINATION");
  }

  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);

  if (limit < 1 || limit > 100) {
    throw new AppError("limit must be an integer between 1 and 100", 400, "INVALID_PAGINATION");
  }

  return { limit, offset };
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

router.post("/upload", async (req, res) => {
  requireBodyObject(req.body);

  const projectID = requireString(req.body, "projectID");
  const category = requireString(req.body, "category");
  const researcherID = requireString(req.body, "researcherID");
  const captureTimestamp = requireString(req.body, "captureTimestamp");
  const fileName = requireString(req.body, "fileName");
  const fileContent = requireString(req.body, "fileContent");

  const id = uuidv4();
  const file = await uploadBlob({ id, fileName, fileContent });

  const record = {
    id,
    projectID,
    researcherID,
    category,
    captureTimestamp,
    file,
  };

  try {
    const createdRecord = await createRecord(record);
    return res.status(201).json({
      success: true,
      data: formatRecordResponse(createdRecord),
    });
  } catch (error) {
    await deleteBlob(file.blobPath).catch((cleanupError) => {
      console.error("Failed to clean up blob after Cosmos create failure", {
        blobPath: file.blobPath,
        message: cleanupError.message,
      });
    });

    throw error;
  }
});

router.get("/records", async (req, res) => {
  const filters = {
    projectID: optionalQueryString(req.query, "projectID"),
    category: optionalQueryString(req.query, "category"),
    researcherID: optionalQueryString(req.query, "researcherID"),
  };
  const pagination = parsePaginationQuery(req.query);
  const records = await getAllRecords(filters, pagination);
  const data = records.map(formatRecordResponse);

  return res.status(200).json({
    success: true,
    count: data.length,
    limit: pagination.limit,
    offset: pagination.offset,
    data,
  });
});

router.delete("/records/:id", async (req, res) => {
  requireBodyObject(req.body);

  const id = req.params.id;
  const projectID = requireString(req.body, "projectID");
  const researcherID = requireString(req.body, "researcherID");
  const record = await getRecord(id, projectID);

  if (record.researcherID !== researcherID) {
    throw new AppError("Forbidden", 403);
  }

  await deleteBlob(record.file?.blobPath);
  await deleteRecord(id, projectID);

  return res.status(200).json({
    success: true,
    message: "Record deleted",
  });
});

router.put("/records/:id", async (req, res) => {
  requireBodyObject(req.body);
  rejectUnsupportedFields(req.body, ["category", "projectID", "researcherID"]);

  const researcherID = requireString(req.body, "researcherID");
  const existingRecord = await findRecordById(req.params.id);

  if (existingRecord.researcherID !== researcherID) {
    throw new AppError("Forbidden", 403);
  }

  const updates = {};

  if (Object.hasOwn(req.body, "category")) {
    updates.category = requireString(req.body, "category");
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
});

export default router;
