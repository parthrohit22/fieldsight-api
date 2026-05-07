# FieldSight API

Production Express.js backend for FieldSight, a cloud-native multimedia sharing API deployed to Azure App Service.

## Stack

- Node.js 18+
- Express
- Azure Cosmos DB Core SQL API
- Azure Blob Storage
- Optional Azure Application Insights
- GitHub Actions CI/CD

## Project Structure

```text
fieldsight-api/
  server.js
  config/
    env.js
  middleware/
    auth.js
    errorHandler.js
  routes/
    records.js
  services/
    blobService.js
    cosmosService.js
  .github/workflows/
    azure-app-service.yml
  .env.example
  .gitignore
  package.json
```

## Local Setup

```bash
npm install
cp .env.example .env
npm start
```

Fill `.env` with real Azure values before starting the API. The CRUD routes require an API key in the `x-api-key` header.

```bash
curl http://localhost:3000/health
```

## Environment Variables

Required App Settings for Azure App Service:

```text
NODE_ENV=production
PORT=8080
CORS_ORIGIN=https://your-frontend-domain.example
FIELD_SIGHT_API_KEY=<long-random-api-key>
JSON_BODY_LIMIT=15mb
MAX_UPLOAD_BYTES=10485760
COSMOS_ENDPOINT=<cosmos-core-sql-endpoint>
COSMOS_KEY=<cosmos-key>
COSMOS_DATABASE_ID=fieldsightdb
COSMOS_CONTAINER_ID=images
COSMOS_PARTITION_KEY=/projectID
AZURE_STORAGE_CONNECTION_STRING=<storage-connection-string>
AZURE_STORAGE_CONTAINER_NAME=imagestore
SCM_DO_BUILD_DURING_DEPLOYMENT=true
```

Optional:

```text
APPLICATIONINSIGHTS_CONNECTION_STRING=<application-insights-connection-string>
```

## Azure Resource Setup

Create an Azure Cosmos DB account using the Core SQL API. The API initializes the database and container if they do not already exist:

- Database: `fieldsightdb`
- Container: `images`
- Partition key: `/projectID`

Create an Azure Storage Account. The API initializes the blob container if it does not already exist:

- Blob container: `imagestore`

Use environment variables or Azure App Service App Settings for every secret. Do not commit `.env`.

## API Authentication

All CRUD endpoints require:

```text
x-api-key: <FIELD_SIGHT_API_KEY>
```

Public endpoints:

- `GET /`
- `GET /health`

## Endpoints

### POST `/upload`

Uploads binary content to Azure Blob Storage and stores metadata in Cosmos DB.

```bash
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -H "x-api-key: $FIELD_SIGHT_API_KEY" \
  -d '{
    "projectID": "project-001",
    "category": "site-photo",
    "researcherID": "researcher-123",
    "captureTimestamp": "2026-05-07T10:30:00Z",
    "fileName": "sample.jpg",
    "fileContent": "<base64-content>"
  }'
```

Response: `201 Created`

```json
{
  "id": "uuid",
  "projectID": "project-001",
  "researcherID": "researcher-123",
  "category": "site-photo",
  "captureTimestamp": "2026-05-07T10:30:00Z",
  "file": {
    "name": "sample.jpg",
    "blobPath": "images/uuid/sample.jpg",
    "blobUrl": "https://..."
  }
}
```

### GET `/records`

Returns all Cosmos DB documents using the exact SQL query:

```sql
SELECT * FROM c
```

```bash
curl http://localhost:3000/records \
  -H "x-api-key: $FIELD_SIGHT_API_KEY"
```

Response: `200 OK`

### PUT `/records/:id`

Updates `category`, `projectID`, or both. When `projectID` changes, the API writes the document to the new partition and removes the old item.

```bash
curl -X PUT http://localhost:3000/records/<id> \
  -H "Content-Type: application/json" \
  -H "x-api-key: $FIELD_SIGHT_API_KEY" \
  -d '{
    "category": "updated-category",
    "projectID": "project-002"
  }'
```

Response: `200 OK`

### DELETE `/records/:id`

Deletes the blob and matching Cosmos DB document. `projectID` is required because Cosmos uses it as the partition key.

```bash
curl -X DELETE http://localhost:3000/records/<id> \
  -H "Content-Type: application/json" \
  -H "x-api-key: $FIELD_SIGHT_API_KEY" \
  -d '{
    "projectID": "project-001"
  }'
```

Response: `204 No Content`

## Application Insights

Create an Application Insights resource in Azure and copy its connection string into the App Service setting:

```text
APPLICATIONINSIGHTS_CONNECTION_STRING=<connection-string>
```

When the variable is present, the API automatically collects requests, dependencies, exceptions, performance telemetry, and console logs.

## Azure App Service Deployment

1. Create a Linux Azure App Service with Node 18 runtime.
2. Add the App Settings listed above.
3. Ensure `SCM_DO_BUILD_DURING_DEPLOYMENT=true` so Azure installs dependencies during zip deployment.
4. Add these GitHub repository secrets:
   - `AZURE_WEBAPP_NAME`
   - `AZURE_WEBAPP_PUBLISH_PROFILE`
5. Push to `main` or run the GitHub Actions workflow manually.

## CI/CD

The included workflow:

- Uses Node 18.
- Runs `npm ci`.
- Runs `npm test`.
- Uploads a deployment artifact.
- Deploys to Azure App Service with a publish profile.

## Production Notes

- Keep Blob Storage private unless a public media surface is explicitly required.
- Rotate `FIELD_SIGHT_API_KEY`, `COSMOS_KEY`, and storage account keys regularly.
- Restrict `CORS_ORIGIN` to trusted frontend origins in production.
- Use App Service logs and Application Insights for operational diagnostics.
