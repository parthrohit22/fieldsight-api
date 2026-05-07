import { BlobServiceClient } from "@azure/storage-blob";
import mime from "mime-types";

import config from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

const blobServiceClient = BlobServiceClient.fromConnectionString(config.storage.connectionString);
const containerClient = blobServiceClient.getContainerClient(config.storage.containerName);

function sanitizeFileName(fileName) {
  const sanitized = fileName
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);

  return sanitized || "upload.bin";
}

function normalizeBase64(fileContent) {
  const trimmed = fileContent.trim();
  const commaIndex = trimmed.indexOf(",");
  return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : trimmed;
}

export function decodeBase64File(fileContent) {
  if (typeof fileContent !== "string" || fileContent.trim() === "") {
    throw new AppError("fileContent must be a non-empty base64 string", 400, "INVALID_FILE_CONTENT");
  }

  const normalized = normalizeBase64(fileContent);

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new AppError("fileContent must be valid base64", 400, "INVALID_FILE_CONTENT");
  }

  const buffer = Buffer.from(normalized, "base64");

  if (!buffer.length) {
    throw new AppError("Decoded fileContent is empty", 400, "INVALID_FILE_CONTENT");
  }

  if (buffer.length > config.maxUploadBytes) {
    throw new AppError("Uploaded file exceeds MAX_UPLOAD_BYTES", 413, "UPLOAD_TOO_LARGE");
  }

  return buffer;
}

export async function initializeBlobContainer() {
  await containerClient.createIfNotExists();
  console.log(`Blob container initialized: ${config.storage.containerName}`);
  return containerClient;
}

export async function uploadBlob({ id, fileName, fileContent }) {
  const safeFileName = sanitizeFileName(fileName);
  const blobPath = `images/${id}/${safeFileName}`;
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  const content = decodeBase64File(fileContent);
  const contentType = mime.lookup(safeFileName) || "application/octet-stream";

  await blockBlobClient.uploadData(content, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
  });

  return {
    name: fileName,
    blobPath,
    blobUrl: blockBlobClient.url,
  };
}

export async function deleteBlob(blobPath) {
  if (!blobPath) {
    return;
  }

  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  await blockBlobClient.deleteIfExists();
}
