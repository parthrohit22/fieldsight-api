import express from "express";
import cors from "cors";

import config from "./config/env.js";
import recordsRouter from "./routes/records.js";
import { authenticateApiKey } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { initializeCosmos } from "./services/cosmosService.js";
import { initializeBlobContainer } from "./services/blobService.js";

async function setupApplicationInsights() {
  if (!config.applicationInsightsConnectionString) {
    return;
  }

  const appInsightsModule = await import("applicationinsights");
  const appInsights = appInsightsModule.default ?? appInsightsModule;

  appInsights
    .setup(config.applicationInsightsConnectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectExceptions(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectConsole(true, true)
    .setSendLiveMetrics(false)
    .start();

  if (appInsights.defaultClient) {
    const roleNameKey = appInsights.defaultClient.context.keys.cloudRole;
    appInsights.defaultClient.context.tags[roleNameKey] = "fieldsight-api";
  }

  console.log("Application Insights initialized");
}

const app = express();

const corsOptions = {
  origin: config.corsOrigin === "*" ? "*" : config.corsOrigin.split(",").map((origin) => origin.trim()),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: config.jsonBodyLimit }));

app.get("/", (req, res) => {
  res.status(200).json({
    service: "FieldSight API",
    status: "running",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
  });
});

app.use("/", authenticateApiKey, recordsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    await setupApplicationInsights();
    await Promise.all([initializeCosmos(), initializeBlobContainer()]);

    app.listen(config.port, () => {
      console.log(`FieldSight API listening on port ${config.port}`);
    });
  } catch (error) {
    console.error("Failed to start FieldSight API", {
      message: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

startServer();

export default app;
