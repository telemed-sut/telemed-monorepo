
# Patient Management Dashboard (Frontend)

A modern, responsive Patient Management System built with **Next.js 14+ (App Router)**, **TypeScript**, **Tailwind CSS**, and **Shadcn UI**.

## 🚀 Features

*   **Role-Based Access Control (RBAC):** Admin and Staff roles with different permissions (e.g., Delete button visible only to Admin).
*   **Secure Authentication:** JWT-based login with automatic token handling and expiration checks.
*   **Patient Management:**
    *   **List:** View patients with pagination, sorting (Name, Date), and search.
    *   **Create/Edit:** Forms with validation for managing patient records.
    *   **Delete:** Remove patient records (Admin only).
*   **Modern UI:** Clean, responsive design with toast notifications for success/error states.
*   **Dockerized:** Ready for production deployment with Docker.

## 🛠️ Tech Stack

*   **Framework:** Next.js 14 (App Router)
*   **Language:** TypeScript
*   **Styling:** Tailwind CSS
*   **UI Components:** Shadcn UI, HugeIcons, Sonner (Toast)
*   **State Management:** Zustand
*   **Form/Validation:** React Hook Form (manual implementation), Zod (optional logic used)

## 📦 Installation & Setup

### Prerequisites
*   Node.js 18+
*   Bun

### 1. Clone the repository
```bash
git clone <repository_url>
cd frontend
```

### 2. Install dependencies
```bash
bun install
```

### 3. Environment Setup
Primary mode (recommended): create a `.env.local` file in the root directory:
```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 4. Run Locally
```bash
bun run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🐳 Docker Setup

The application is fully containerized. To run the frontend in a container:

1.  **Build and Run**
    ```bash
    docker build -t patient-frontend .
    docker run -p 3000:3000 -e NEXT_PUBLIC_API_BASE_URL=http://host.docker.internal:8000 patient-frontend
    ```

2.  **Using Docker Compose** (Full Stack)
    From the repository root:
    ```bash
    ./scripts/dev-backend.sh
    ```

## 🔐 Demo Credentials

Use the following accounts to test the application (provided by Backend):

| Role  | Email | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@example.com` | `AdminPass123` | Full access (View, Create, Edit, **Delete**) |
| **Doctor** | `doctor@example.com` | `DoctorPass123` | Assigned clinical access with create and edit actions |
| **Medical Student** | `medical-student@example.com` | `MedicalStudentPass123` | Assigned clinical and meeting access in read-only mode |

## 📂 Project Structure

```
├── app/                # Next.js App Router pages
│   ├── login/          # Login page
│   ├── patients/       # Patients list (and Create/Edit sheets)
│   └── layout.tsx      # Root layout
├── components/         # Reusable components
│   ├── dashboard/      # Specific components (Sidebar, Tables)
│   └── ui/             # Shadcn UI components
├── lib/                # Utilities and API client
├── store/              # Global state (Zustand)
└── public/             # Static assets
```
