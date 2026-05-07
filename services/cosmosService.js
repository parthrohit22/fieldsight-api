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
    container = client
      .database(config.cosmos.databaseId)
      .container(config.cosmos.containerId);
  }

  return container;
}

function isNotFound(error) {
  return error.code === 404 || error.statusCode === 404;
}

function stripSystemFields(record) {
  const { _rid, _self, _etag, _attachments, _ts, ...document } = record;
  return document;
}

/* ================= INITIALIZE ================= */

export async function initializeCosmos() {
  const { database } = await client.databases.createIfNotExists({
    id: config.cosmos.databaseId,
  });

  const { container: initializedContainer } =
    await database.containers.createIfNotExists({
      id: config.cosmos.containerId,
      partitionKey: {
        paths: [config.cosmos.partitionKey],
      },
    });

  container = initializedContainer;

  console.log(
    `Cosmos DB initialized: ${config.cosmos.databaseId}/${config.cosmos.containerId}`
  );

  return container;
}

/* ================= CREATE ================= */

export async function createRecord(record) {
  const { resource } = await getContainer().items.create(
    stripSystemFields(record)
  );

  return resource;
}

/* ================= GET ALL (FILTER + PAGINATION) ================= */

export async function getAllRecords(
  filters = {},
  pagination = { limit: 20, offset: 0 }
) {
  const conditions = [];
  const parameters = [];
  const limit = pagination.limit ?? 20;
  const offset = pagination.offset ?? 0;

  if (filters.projectID) {
    conditions.push("c.projectID = @projectID");
    parameters.push({
      name: "@projectID",
      value: filters.projectID,
    });
  }

  if (filters.category) {
    conditions.push("c.category = @category");
    parameters.push({
      name: "@category",
      value: filters.category,
    });
  }

  if (filters.researcherID) {
    conditions.push("c.researcherID = @researcherID");
    parameters.push({
      name: "@researcherID",
      value: filters.researcherID,
    });
  }

  const whereClause = conditions.length
    ? ` WHERE ${conditions.join(" AND ")}`
    : "";

  const countQuery = `SELECT VALUE COUNT(1) FROM c${whereClause}`;
  const dataQuery = `
    SELECT
      c.id,
      c.projectID,
      c.category,
      c.researcherID,
      c.captureTimestamp,
      c.file
    FROM c
    ${whereClause}
    OFFSET @offset LIMIT @limit
  `;

  const { resources: countResources } = await getContainer()
    .items.query(
      {
        query: countQuery,
        parameters,
      },
      {
        enableCrossPartitionQuery: true,
      }
    )
    .fetchAll();

  const { resources } = await getContainer()
    .items.query(
      {
        query: dataQuery,
        parameters: [
          ...parameters,
          { name: "@offset", value: offset },
          { name: "@limit", value: limit },
        ],
      },
      {
        enableCrossPartitionQuery: true,
      }
    )
    .fetchAll();

  return {
    resources: resources.map(stripSystemFields),
    total: countResources[0] ?? 0,
  };
}

/* ================= GET SINGLE ================= */

export async function getRecord(id, projectID) {
  try {
    const { resource } = await getContainer()
      .item(id, projectID)
      .read();

    if (!resource) {
      throw new AppError(
        "Record not found",
        404,
        "RECORD_NOT_FOUND"
      );
    }

    return resource;
  } catch (error) {
    if (isNotFound(error)) {
      throw new AppError(
        "Record not found",
        404,
        "RECORD_NOT_FOUND"
      );
    }

    throw error;
  }
}

/* ================= FIND BY ID ================= */

export async function findRecordById(id) {
  const { resources } = await getContainer()
    .items.query(
      {
        query: "SELECT * FROM c WHERE c.id = @id",
        parameters: [
          {
            name: "@id",
            value: id,
          },
        ],
      },
      {
        enableCrossPartitionQuery: true,
      }
    )
    .fetchAll();

  if (!resources.length) {
    throw new AppError(
      "Record not found",
      404,
      "RECORD_NOT_FOUND"
    );
  }

  return resources[0];
}

/* ================= UPDATE ================= */

export async function updateRecord(id, updates) {
  const existingRecord = await findRecordById(id);

  const updatedRecord = stripSystemFields({
    ...existingRecord,
    ...updates,
    id: existingRecord.id,
  });

  // Partition key changed
  if (
    updates.projectID &&
    updates.projectID !== existingRecord.projectID
  ) {
    const { resource } = await getContainer()
      .items.create(updatedRecord);

    await getContainer()
      .item(id, existingRecord.projectID)
      .delete();

    return resource;
  }

  const { resource } = await getContainer()
    .item(id, existingRecord.projectID)
    .replace(updatedRecord);

  return resource;
}

/* ================= DELETE ================= */

export async function deleteRecord(id, projectID) {
  try {
    await getContainer()
      .item(id, projectID)
      .delete();
  } catch (error) {
    if (isNotFound(error)) {
      throw new AppError(
        "Record not found",
        404,
        "RECORD_NOT_FOUND"
      );
    }

    throw error;
  }
}
