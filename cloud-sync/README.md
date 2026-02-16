# Tidemark Cloud Sync API

Cloudflare Workers + D1 database for syncing Records and Folders between Browser Extension and Desktop app.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create D1 Database

```bash
npx wrangler d1 create tidemark
```

Copy the `database_id` from the output and update `wrangler.toml`.

### 3. Initialize Database Schema

```bash
npx wrangler d1 execute tidemark --local --file=./schema.sql
npx wrangler d1 execute tidemark --remote --file=./schema.sql
```

### 4. Set JWT Secret

For local development:
```bash
echo "JWT_SECRET=your-secret-key-change-in-production" > .dev.vars
```

For production:
```bash
npx wrangler secret put JWT_SECRET
# Enter your production secret when prompted
```

### 5. Development

```bash
npm run dev
```

The API will be available at `http://localhost:8787`

### 6. Deploy

```bash
npm run deploy
```

## API Endpoints

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| POST | `/auth/google` | Exchange Google OAuth token for JWT | No |
| GET | `/sync?since={iso8601}` | Incremental sync | Yes |
| POST | `/records` | Create/update record | Yes |
| DELETE | `/records/{id}` | Soft delete record | Yes |
| POST | `/folders` | Create/update folder | Yes |
| DELETE | `/folders/{id}` | Soft delete folder | Yes |
| GET | `/health` | Health check | No |

## Authentication

All endpoints except `/auth/google` and `/health` require JWT authentication.

Include the JWT token in the Authorization header:
```
Authorization: Bearer {jwt_token}
```

## Testing

See `test/` directory for manual testing scripts.

## Subrequest Count

Each `/sync` call uses **2 subrequests**:
- 1 for querying records
- 1 for querying folders

This is well within Cloudflare's 1000 subrequest limit.

## Database Schema

See `schema.sql` for the complete D1 database schema.
