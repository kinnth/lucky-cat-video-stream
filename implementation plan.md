# Implementation Plan: Cloudflare Backend & Authentication

## Current Status
✅ Frontend deployed to Cloudflare Pages (manaprana.org)
✅ Environment variables configured
✅ Architecture documented

## Next Steps

---

## Phase 1: Backend Infrastructure Setup

### 1.1 Create Cloudflare D1 Database
**Goal**: Set up the primary SQL database for user data and game state

**Tasks**:
- [ ] Create D1 database instance
  ```bash
  wrangler d1 create mana-db
  ```
- [ ] Note the database ID for wrangler.toml
- [ ] Create migrations directory structure

**Deliverable**: Database instance ready for schema creation

---

### 1.2 Create KV Namespaces
**Goal**: Set up key-value stores for sessions and caching

**Tasks**:
- [ ] Create SESSIONS namespace
  ```bash
  wrangler kv:namespace create "SESSIONS"
  wrangler kv:namespace create "SESSIONS" --preview
  ```
- [ ] Create CACHE namespace
  ```bash
  wrangler kv:namespace create "CACHE"
  wrangler kv:namespace create "CACHE" --preview
  ```
- [ ] Note namespace IDs for wrangler.toml

**Deliverable**: Two KV namespaces (SESSIONS, CACHE) with IDs

---

### 1.3 Initialize Workers API Project
**Goal**: Create the backend API using Cloudflare Workers

**Tasks**:
- [ ] Create `api/` directory in project root
- [ ] Initialize Workers project with TypeScript
  ```bash
  cd api
  npm create cloudflare@latest . -- --template worker-typescript
  ```
- [ ] Install dependencies:
  - `hono` - Web framework
  - `jose` - JWT handling
  - `zod` - Schema validation
  - `bcryptjs` - Password hashing

**Deliverable**: Workers project scaffolded with dependencies

---

## Phase 2: Database Schema & Migrations

### 2.1 Create Database Schema
**Goal**: Define all tables and relationships

**Tasks**:
- [ ] Create migration file: `0001_initial_schema.sql`
- [ ] Define tables:
  - `users` - User accounts
  - `game_sessions` - Active and completed games
  - `user_cards` - Card collections
  - `daily_practices` - Daily practice tracking
- [ ] Apply migration:
  ```bash
  wrangler d1 migrations apply mana-db
  ```

**Deliverable**: Database schema created and applied

---

### 2.2 Seed Initial Data (Optional)
**Goal**: Add starter cards and game data

**Tasks**:
- [ ] Create seed data SQL file
- [ ] Define initial card collection
- [ ] Run seed script

**Deliverable**: Database populated with initial game data

---

## Phase 3: Authentication System

### 3.1 User Registration
**Goal**: Allow users to create accounts

**Tasks**:
- [ ] Create `/api/auth/register` endpoint
- [ ] Implement:
  - Email validation (Zod schema)
  - Password hashing (bcryptjs)
  - User creation in D1
  - Return JWT token
- [ ] Store session in KV

**API Contract**:
```typescript
POST /api/auth/register
Body: { email, username, password }
Response: { token, user: { id, email, username } }
```

---

### 3.2 User Login
**Goal**: Authenticate existing users

**Tasks**:
- [ ] Create `/api/auth/login` endpoint
- [ ] Implement:
  - Credential validation
  - Password verification
  - JWT generation
  - Session storage in KV
  - Update last_login timestamp

**API Contract**:
```typescript
POST /api/auth/login
Body: { email, password }
Response: { token, user: { id, email, username, manaPoints } }
```

---

### 3.3 Authentication Middleware
**Goal**: Protect API routes

**Tasks**:
- [ ] Create JWT verification middleware
- [ ] Validate tokens from Authorization header
- [ ] Check session in KV
- [ ] Attach user to request context

**Usage**:
```typescript
app.use('/api/game/*', authMiddleware)
```

---

### 3.4 Token Refresh & Logout
**Goal**: Manage session lifecycle

**Tasks**:
- [ ] Create `/api/auth/refresh` endpoint
- [ ] Create `/api/auth/logout` endpoint
- [ ] Implement token refresh logic
- [ ] Clear KV session on logout

---

## Phase 4: Game API Endpoints

### 4.1 Game Session Management
**Goal**: Handle game creation and state

**Tasks**:
- [ ] Create `/api/game/start` endpoint
  - Check for existing daily practice
  - Create new game session in KV
  - Return initial game state
- [ ] Create `/api/game/state` endpoint
  - Retrieve current game state from KV
- [ ] Create `/api/game/move` endpoint
  - Validate move
  - Update game state in KV
  - Return updated state

---

### 4.2 Game Completion & Rewards
**Goal**: Process completed games and award mana

**Tasks**:
- [ ] Create `/api/game/complete` endpoint
- [ ] Implement:
  - Validate game completion
  - Calculate score and mana earned
  - Save to D1 (game_sessions, daily_practices)
  - Update user mana_points
  - Clear KV session
  - Update leaderboard cache

---

### 4.3 User Profile & Stats
**Goal**: Retrieve user data and statistics

**Tasks**:
- [ ] Create `/api/user/profile` endpoint
- [ ] Create `/api/user/stats` endpoint
- [ ] Create `/api/user/collection` endpoint
- [ ] Implement aggregation queries for stats

---

## Phase 5: Frontend Integration

### 5.1 API Client Setup
**Goal**: Connect React app to Workers API

**Tasks**:
- [ ] Create API client utility (`src/lib/api.ts`)
- [ ] Implement:
  - Base URL configuration
  - Token management
  - Request/response interceptors
  - Error handling

**Example**:
```typescript
export const api = {
  auth: {
    register: (data) => fetch('/api/auth/register', ...),
    login: (data) => fetch('/api/auth/login', ...),
  },
  game: {
    start: () => fetch('/api/game/start', ...),
    move: (move) => fetch('/api/game/move', ...),
  }
}
```

---

### 5.2 Authentication Context
**Goal**: Manage auth state in React

**Tasks**:
- [ ] Create AuthContext (`src/contexts/AuthContext.tsx`)
- [ ] Implement:
  - Login/logout functions
  - Token storage (localStorage)
  - User state management
  - Auto token refresh
- [ ] Create ProtectedRoute component

---

### 5.3 Update Components
**Goal**: Connect UI to backend

**Tasks**:
- [ ] Update DailyPracticeFlow to use real API
- [ ] Add loading states
- [ ] Add error handling
- [ ] Implement optimistic updates

---

## Phase 6: Deployment & Configuration

### 6.1 Configure wrangler.toml
**Goal**: Link all services together

**Tasks**:
- [ ] Add D1 binding
- [ ] Add KV bindings
- [ ] Set environment variables
- [ ] Configure routes

**Example wrangler.toml**:
```toml
name = "mana-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "mana-db"
database_id = "<from-step-1.1>"

[[kv_namespaces]]
binding = "SESSIONS"
id = "<from-step-1.2>"

[[kv_namespaces]]
binding = "CACHE"
id = "<from-step-1.2>"

[vars]
JWT_SECRET = "your-secret-key"
ENVIRONMENT = "production"
```

---

### 6.2 Deploy Workers API
**Goal**: Deploy backend to Cloudflare

**Tasks**:
- [ ] Test locally with `wrangler dev`
- [ ] Deploy to production:
  ```bash
  wrangler deploy
  ```
- [ ] Verify endpoints are accessible
- [ ] Update frontend API base URL

---

### 6.3 Connect Frontend to Backend
**Goal**: Update Pages to use Workers API

**Tasks**:
- [ ] Configure CORS in Workers
- [ ] Update frontend environment variables
- [ ] Set API_URL to Workers route
- [ ] Redeploy frontend

---

## Phase 7: Testing & Optimization

### 7.1 End-to-End Testing
**Tasks**:
- [ ] Test registration flow
- [ ] Test login flow
- [ ] Test game session creation
- [ ] Test game completion
- [ ] Test mana point accumulation

---

### 7.2 Performance Optimization
**Tasks**:
- [ ] Add caching headers
- [ ] Implement KV caching for frequent queries
- [ ] Optimize D1 queries with indexes
- [ ] Monitor Worker execution time

---

### 7.3 Security Hardening
**Tasks**:
- [ ] Implement rate limiting
- [ ] Add CSRF protection
- [ ] Validate all inputs
- [ ] Sanitize user data
- [ ] Add security headers

---

## Timeline Estimate

- **Phase 1**: 2-3 hours (Infrastructure setup)
- **Phase 2**: 1-2 hours (Database schema)
- **Phase 3**: 4-6 hours (Authentication)
- **Phase 4**: 4-6 hours (Game API)
- **Phase 5**: 3-4 hours (Frontend integration)
- **Phase 6**: 1-2 hours (Deployment)
- **Phase 7**: 2-3 hours (Testing)

**Total**: ~20-30 hours of development

---

## Success Criteria

✅ Users can register and login
✅ Authentication persists across sessions
✅ Users can start and complete daily practices
✅ Mana points are tracked and displayed
✅ Game state persists correctly
✅ API is secure and performant
✅ Frontend and backend are fully integrated

---

## Dependencies & Prerequisites

- ✅ Cloudflare account with Workers/Pages access
- ✅ Wrangler CLI installed
- ✅ API token configured
- ✅ Frontend deployed
- ⏳ D1 database created
- ⏳ KV namespaces created
- ⏳ Workers project initialized

---

## Next Immediate Actions

1. **Create D1 Database**:
   ```bash
   wrangler d1 create mana-db
   ```

2. **Create KV Namespaces**:
   ```bash
   wrangler kv:namespace create "SESSIONS"
   wrangler kv:namespace create "CACHE"
   ```

3. **Initialize API Project**:
   ```bash
   mkdir api && cd api
   npm create cloudflare@latest . -- --template worker-typescript
   ```