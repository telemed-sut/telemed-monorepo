# Patient Management System (Full Stack)

A production-ready full-stack patient management application built with **Next.js** (frontend), **FastAPI** (backend), and **PostgreSQL** (database), featuring JWT authentication, role-based access control, and complete CRUD operations.

---

## 📋 Table of Contents
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Running Locally](#-running-locally-without-docker)
- [Running with Docker](#-running-with-docker)
- [Demo Credentials](#-demo-credentials)
- [API Documentation](#-api-documentation)
- [Project Structure](#-project-structure)
- [Testing](#-testing)

---

## ✨ Features

### Authentication & Authorization
- ✅ JWT-based authentication with secure token handling
- ✅ Role-based access control (Admin/Staff)
- ✅ Password hashing with bcrypt
- ✅ Protected API routes requiring Bearer tokens
- ✅ Automatic token validation and expiration (401 on invalid/expired tokens)

### Patient Management
- ✅ **Full CRUD operations** (Create, Read, Update, Delete)
- ✅ **Advanced search** across name, email, and phone fields
- ✅ **Pagination** with customizable page size (5, 10, 20, 50, or All)
- ✅ **Sorting** by creation date, update date, or name
- ✅ **Role-based delete** (Admin only)
- ✅ Real-time data validation with detailed error messages

### User Experience
- ✅ Modern, responsive UI with Next.js
- ✅ Loading states and skeleton screens
- ✅ Toast notifications for user actions
- ✅ Empty states and error handling
- ✅ Form validation with clear feedback

---

## 🛠 Tech Stack

### Frontend
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **UI Components:** Radix UI, Shadcn/ui
- **Styling:** Tailwind CSS
- **State Management:** Zustand
- **Icons:** Hugeicons
- **Package Manager:** npm/bun

### Backend
- **Framework:** FastAPI 0.110+
- **Language:** Python 3.11+
- **ORM:** SQLAlchemy 2.x
- **Migrations:** Alembic
- **Authentication:** python-jose (JWT), passlib (bcrypt)
- **Validation:** Pydantic v2

### Database
- **Primary:** PostgreSQL 15+ (via Neon/Supabase or Local)
- **Driver:** psycopg 3.x

### DevOps
- **Containerization:** Docker + Docker Compose
- **API Testing:** Postman Collection included

---

## 🏗 Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│                 │         │                 │         │                 │
│  Next.js        │ ◄────► │  FastAPI        │ ◄────► │  PostgreSQL     │
│  Frontend       │  HTTP   │  Backend        │  SQL    │  Database       │
│  (Port 3000)    │  + JWT  │  (Port 8000)    │         │  (Port 5432)    │
│                 │         │                 │         │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

**Key Components:**
- **Frontend:** Handles UI/UX, client-side routing, and API consumption
- **Backend:** RESTful API with JWT auth, business logic, and database interactions
- **Database:** Stores users, patients, and relational data with proper indexing

---

## 🚀 Quick Start

### Prerequisites
- **Docker** (recommended) OR
- **Node.js 18+** + **Python 3.11+** + **PostgreSQL 15+**

### One-Command Setup (Docker)
```bash
# Clone the repository
git clone <your-repo-url>
cd back-take-home-test-requirement

# Start all services
docker compose up --build
```

Then visit:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000
- **API Docs:** http://localhost:8000/docs

---

## 💻 Running Locally (without Docker)

### 1. Setup Backend

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env with your PostgreSQL credentials (see below)

# Run migrations
alembic upgrade head

# Seed demo data
python -m scripts.seed

# Start backend server
uvicorn app.main:app --reload
```

**Backend will run on:** http://localhost:8000

### 2. Setup Frontend

```bash
# Navigate to frontend directory (in new terminal)
cd frontend

# Install dependencies
npm install  # or: bun install

# Start development server
npm run dev  # or: bun dev
```

**Frontend will run on:** http://localhost:3000

### Environment Variables

**Backend (`.env`):**
```bash
DATABASE_URL=postgresql+psycopg://user:password@host:5432/database?sslmode=require
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=3600
CORS_ORIGINS=http://localhost:3000,http://localhost:8080
```

**Frontend:**
No `.env` needed for local development (defaults to `http://localhost:8000`)

For production, set:
```bash
NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.com
```

---

## 🐳 Running with Docker

### Using Docker Compose (Recommended)

```bash
# Build and start all services
docker compose up --build

# Run in detached mode
docker compose up -d --build

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

### Docker Architecture

The `docker-compose.yml` defines three services:

1. **Frontend (patient-frontend):**
   - Built from `./frontend/Dockerfile`
   - Exposed on port 3000
   - Environment: `NEXT_PUBLIC_API_BASE_URL`

2. **Backend (patient-backend):**
   - Built from `./backend/Dockerfile`
   - Exposed on port 8000
   - Runs migrations and seeds on startup
   - Environment: `DATABASE_URL`, `JWT_SECRET`, etc.

3. **Database (patient-db):**
   - PostgreSQL 15-alpine image
   - Persistent volume: `postgres_data`
   - Exposed on port 5432

---

## 🔑 Demo Credentials

Two demo users are automatically seeded:

### Admin User
- **Email:** `admin@example.com`
- **Password:** `AdminPass123`
- **Permissions:** Full CRUD (Create, Read, Update, Delete)

### Staff User
- **Email:** `staff@example.com`
- **Password:** `StaffPass123`
- **Permissions:** Create, Read, Update (Delete restricted)

**Note:** Admin users can delete patients; Staff users will see a 403 error if attempting deletion.

---

## 📚 API Documentation

### Authentication

#### Login
```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "AdminPass123"
}

Response:
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

#### Refresh Token
```http
POST /auth/refresh
Authorization: Bearer <token>
```

### Patient Management

All patient endpoints require `Authorization: Bearer <token>` header.

#### List Patients (with pagination, search, sort)
```http
GET /patients?page=1&limit=20&q=john&sort=created_at&order=desc
```

#### Get Single Patient
```http
GET /patients/{id}
```

#### Create Patient
```http
POST /patients
Content-Type: application/json

{
  "first_name": "John",
  "last_name": "Doe",
  "date_of_birth": "1990-01-15",
  "gender": "Male",
  "phone": "+1234567890",
  "email": "john@example.com",
  "address": "123 Main St"
}
```

#### Update Patient
```http
PUT /patients/{id}
Content-Type: application/json

{
  "first_name": "Jane",
  "email": "jane@example.com"
}
```

#### Delete Patient (Admin only)
```http
DELETE /patients/{id}
```

**Interactive API Docs:** http://localhost:8000/docs (Swagger UI)

---

## 📁 Project Structure

```
back-take-home-test-requirement/
├── frontend/                    # Next.js application
│   ├── app/                     # App router pages
│   │   ├── (auth)/             # Auth-protected routes
│   │   │   └── patients/       # Patient management pages
│   │   ├── api/                # API route handlers
│   │   └── login/              # Login page
│   ├── components/             # React components
│   │   ├── dashboard/          # Dashboard-specific components
│   │   └── ui/                 # Reusable UI components
│   ├── lib/                    # Utilities and API client
│   ├── store/                  # Zustand state management
│   ├── Dockerfile              # Frontend container definition
│   └── package.json
│
├── backend/                     # FastAPI application
│   ├── app/
│   │   ├── api/                # API route handlers
│   │   │   ├── auth.py         # Authentication endpoints
│   │   │   └── patients.py     # Patient CRUD endpoints
│   │   ├── core/               # Core configurations
│   │   │   ├── config.py       # Settings management
│   │   │   └── security.py     # JWT utilities
│   │   ├── models/             # SQLAlchemy models
│   │   │   ├── user.py         # User model with role enum
│   │   │   └── patient.py      # Patient model
│   │   ├── schemas/            # Pydantic schemas
│   │   ├── services/           # Business logic layer
│   │   └── db/                 # Database session management
│   ├── alembic/                # Database migrations
│   │   ├── versions/           # Migration files
│   │   └── env.py              # Alembic configuration
│   ├── scripts/
│   │   └── seed.py             # Demo data seeder
│   ├── tests/                  # Unit and API tests
│   ├── Dockerfile              # Backend container definition
│   ├── requirements.txt        # Python dependencies
│   └── .env.example            # Environment template
│
├── docker-compose.yml          # Multi-container orchestration
├── README.md                   # This file
└── Patient_Management_API.postman_collection.json
```

---

## 🧪 Testing

### Backend Tests

```bash
cd backend
source .venv/bin/activate

# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_auth.py
```

### API Testing with Postman

1. Import `Patient_Management_API.postman_collection.json` into Postman
2. Set environment variable:
   - `base_url`: `http://localhost:8000`
3. Run collection:
   - Login → Create Patient → List Patients → Update → Delete

### Frontend Testing

```bash
cd frontend
npm run build  # Verify production build
```

---

## 🔒 Security Features

- ✅ **Password Hashing:** bcrypt with automatic salting
- ✅ **JWT Tokens:** HMAC-SHA256 signed tokens with expiration
- ✅ **CORS Protection:** Whitelist-based origin validation
- ✅ **SQL Injection Prevention:** Parameterized queries via ORM
- ✅ **Input Validation:** Pydantic schema validation on all endpoints
- ✅ **Role-Based Access:** Granular permissions (admin/staff)

---

## 📝 Notes

### Database Choices
This project supports:
- **Cloud PostgreSQL:** Neon, Supabase (recommended for demos)
- **Local PostgreSQL:** Via Docker or native installation
- **Development:** SQLite NOT recommended (UUID compatibility issues)

### CORS Configuration
Default allowed origins: `http://localhost:3000`, `http://localhost:8080`
To add more origins, update `CORS_ORIGINS` in backend `.env`

### Migrations
- Automatically run on Docker startup via entrypoint script
- Manual: `alembic upgrade head` (apply) / `alembic downgrade -1` (rollback)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is created as a take-home assessment and is provided as-is for evaluation purposes.

---

## 👤 Contact

For questions or feedback regarding this implementation, please refer to the submission documentation.

---

**Built with ❤️ for the Full Stack Developer Take-Home Assessment**
