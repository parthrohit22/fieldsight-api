import { CosmosClient } from "@azure/cosmos";

import config from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

const client = new CosmosClient({
  endpoint: config.cosmos.endpoint,
  key: config.cosmos.key,
});

let container;

function getContainer() {
  if (!container) {
    container = client.database(config.cosmos.databaseId).container(config.cosmos.containerId);
  }

  return container;
}

function stripSystemFields(record) {
  const { _rid, _self, _etag, _attachments, _ts, ...document } = record;
  return document;
}

function isNotFound(error) {
  return error.code === 404 || error.statusCode === 404;
}

export async function initializeCosmos() {
  const { database } = await client.databases.createIfNotExists({
    id: config.cosmos.databaseId,
  });

  const { container: initializedContainer } = await database.containers.createIfNotExists({
    id: config.cosmos.containerId,
    partitionKey: {
      paths: [config.cosmos.partitionKey],
    },
  });

  container = initializedContainer;
  console.log(`Cosmos DB initialized: ${config.cosmos.databaseId}/${config.cosmos.containerId}`);
  return container;
}

export async function createRecord(record) {
  const { resource } = await getContainer().items.create(stripSystemFields(record));
  return resource;
}

export async function getAllRecords() {
  const { resources } = await getContainer()
    .items.query({
      query: "SELECT * FROM c",
    }, {
      enableCrossPartitionQuery: true,
    })
    .fetchAll();

  return resources;
}

export async function getRecord(id, projectID) {
  try {
    const { resource } = await getContainer().item(id, projectID).read();

    if (!resource) {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }

    return resource;
  } catch (error) {
    if (isNotFound(error)) {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }

    throw error;
  }
}

export async function findRecordById(id) {
  const { resources } = await getContainer()
    .items.query({
      query: "SELECT * FROM c WHERE c.id = @id",
      parameters: [{ name: "@id", value: id }],
    }, {
      enableCrossPartitionQuery: true,
    })
    .fetchAll();

  if (!resources.length) {
    throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
  }

  return resources[0];
}

export async function updateRecord(id, updates) {
  const existingRecord = await findRecordById(id);
  const updatedRecord = stripSystemFields({
    ...existingRecord,
    ...updates,
    id: existingRecord.id,
  });

  if (updates.projectID && updates.projectID !== existingRecord.projectID) {
    const { resource } = await getContainer().items.create(updatedRecord);
    await getContainer().item(id, existingRecord.projectID).delete();
    return resource;
  }

  const { resource } = await getContainer().item(id, existingRecord.projectID).replace(updatedRecord);
  return resource;
}

export async function deleteRecord(id, projectID) {
  try {
    await getContainer().item(id, projectID).delete();
  } catch (error) {
    if (isNotFound(error)) {
      throw new AppError("Record not found", 404, "RECORD_NOT_FOUND");
    }

    throw error;
  }
}
