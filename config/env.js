import dotenv from "dotenv";

dotenv.config({ quiet: true });

function required(name) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function numberFromEnv(name, defaultValue) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number`);
  }

  return value;
}

const cosmosPartitionKey = process.env.COSMOS_PARTITION_KEY || "/projectID";

if (cosmosPartitionKey !== "/projectID") {
  throw new Error("COSMOS_PARTITION_KEY must be /projectID");
}

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: numberFromEnv("PORT", 3000),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "15mb",
  maxUploadBytes: numberFromEnv("MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
  apiKey: required("FIELD_SIGHT_API_KEY"),
  applicationInsightsConnectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || "",
  cosmos: Object.freeze({
    endpoint: required("COSMOS_ENDPOINT"),
    key: required("COSMOS_KEY"),
    databaseId: process.env.COSMOS_DATABASE_ID || "fieldsightdb",
    containerId: process.env.COSMOS_CONTAINER_ID || "images",
    partitionKey: cosmosPartitionKey,
  }),
  storage: Object.freeze({
    connectionString: required("AZURE_STORAGE_CONNECTION_STRING"),
    containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || "imagestore",
  }),
});

export default config;
