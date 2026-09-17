# College Integration & API Documentation
## Smart Attendance Management System

This document outlines the API endpoints, integration options, and security specifications for integrating the **Smart Attendance System** with the official College Website / ERP / Student Portal.

---

## 1. Overview of Integration Methods

The college can integrate this application in **three main ways**:

### Option 1: REST API Integration (Recommended for ERP / Student Portal)
The college website server makes HTTP API requests to our backend to fetch live attendance, sync student lists, or display student attendance on student profile pages.

### Option 2: Automated Push Sync (Webhook)
Our server automatically pushes attendance data to the college portal endpoint at the end of each class or at scheduled intervals.

### Option 3: Subdomain / Portal Embed (Fastest Setup)
Host the app at a subdomain (e.g. `https://attendance.yourcollege.edu`) or display the student/teacher portal inside an `<iframe>` on the college website.

---

## 2. Server Base URL & Authentication

- **Base URL**: `https://<YOUR_DEPLOYED_DOMAIN>/api` (or `http://<SERVER_IP>:8000/api` during testing)
- **Portal API Base**: `https://<YOUR_DEPLOYED_DOMAIN>/api/portal/v1`

### Authentication Methods
For **Portal/Server-to-Server APIs**, request authentication is handled via a secure shared **API Key**.

Include the API Key in every HTTP request header:
```http
Authorization: Bearer YOUR_PORTAL_API_KEY
```
*or alternatively:*
```http
X-Portal-Api-Key: YOUR_PORTAL_API_KEY
```

---

## 3. Dedicated College Portal API Endpoints (`/api/portal/v1/`)

### 1. Health Check
* **Endpoint**: `GET /api/portal/v1/health`
* **Description**: Verify API availability, database connection, and student count.
* **Headers**: `Authorization: Bearer <PORTAL_API_KEY>`
* **Response (200 OK)**:
```json
{
  "ok": true,
  "service": "smart-attendance",
  "students": 450,
  "face_embeddings": 450,
  "push_configured": true
}
```

---

### 2. Fetch Classes List
* **Endpoint**: `GET /api/portal/v1/classes`
* **Description**: Returns all departments, classes, sections, and academic years registered in the attendance system.
* **Headers**: `Authorization: Bearer <PORTAL_API_KEY>`
* **Response (200 OK)**:
```json
{
  "classes": [
    {
      "id": 1,
      "name": "B.Tech CSE",
      "section": "A",
      "academic_year": "2024-2028",
      "label": "B.Tech CSE - Sec A (2024-2028)"
    }
  ]
}
```

---

### 3. Fetch Student Directory & College Mapping Status
* **Endpoint**: `GET /api/portal/v1/students`
* **Query Parameters**: 
  - `class_id` (optional, integer): Filter students by class ID.
* **Headers**: `Authorization: Bearer <PORTAL_API_KEY>`
* **Response (200 OK)**:
```json
{
  "count": 60,
  "mapped": 58,
  "unmapped": 2,
  "students": [
    {
      "id": 12,
      "portal_student_id": "COLLEGE_REG_9921",
      "name": "Aarav Sharma",
      "roll": "CSE-2024-001",
      "class_id": 1,
      "mapped": true
    }
  ]
}
```

---

### 4. Sync / Bulk Import Students from College Database
* **Endpoint**: `POST /api/portal/v1/students/sync`
* **Description**: Send student roster updates from the college database to the attendance system.
* **Headers**: 
  - `Authorization: Bearer <PORTAL_API_KEY>`
  - `Content-Type: application/json`
* **Request Body**:
```json
{
  "students": [
    {
      "portal_student_id": "COLLEGE_REG_9921",
      "name": "Aarav Sharma",
      "roll": "CSE-2024-001",
      "class_id": 1
    }
  ]
}
```
* **Response (200 OK)**:
```json
{
  "created": 1,
  "updated": 0,
  "errors": []
}
```

---

### 5. Fetch Attendance Records (For Student Portal Display)
* **Endpoint**: `GET /api/portal/v1/attendance`
* **Query Parameters**:
  - `date` (optional, `YYYY-MM-DD`): Single date filter (defaults to today if no dates given).
  - `from` (optional, `YYYY-MM-DD`): Start date of range.
  - `to` (optional, `YYYY-MM-DD`): End date of range.
  - `class_id` (optional, integer): Filter by class ID.
  - `subject_id` (optional, integer): Filter by subject ID.
* **Headers**: `Authorization: Bearer <PORTAL_API_KEY>`
* **Response (200 OK)**:
```json
{
  "filters": {
    "date": "2026-08-31",
    "from": null,
    "to": null,
    "class_id": 1,
    "subject_id": null
  },
  "count": 45,
  "unmapped_students": 0,
  "records": [
    {
      "record_id": 302,
      "date": "2026-08-31",
      "timestamp": "2026-08-31T09:15:00Z",
      "student_id": 12,
      "portal_student_id": "COLLEGE_REG_9921",
      "student_name": "Aarav Sharma",
      "roll": "CSE-2024-001",
      "class_name": "B.Tech CSE - Sec A",
      "subject_name": "Data Structures",
      "status": "Present",
      "confidence": 98.4,
      "marked_by": "Dr. Smith"
    }
  ]
}
```

---

### 6. Export Attendance Data Package
* **Endpoint**: `GET /api/portal/v1/attendance/export`
* **Description**: Standard JSON package for ERP bulk attendance sync.
* **Query Parameters**: Same as `/api/portal/v1/attendance` (`date`, `from`, `to`, `class_id`, `subject_id`).
* **Headers**: `Authorization: Bearer <PORTAL_API_KEY>`
* **Response (200 OK)**:
```json
{
  "schema_version": 1,
  "system": "smart-attendance",
  "count": 45,
  "records": [ ... ]
}
```

---

### 7. Trigger Webhook Attendance Push
* **Endpoint**: `POST /api/portal/v1/attendance/push`
* **Description**: Directs the attendance server to assemble and push selected attendance data immediately to the college server's webhook endpoint (`PORTAL_PUSH_URL`).
* **Headers**: `Authorization: Bearer <PORTAL_API_KEY>`
* **Request Body**:
```json
{
  "date": "2026-08-31",
  "class_id": 1,
  "subject_id": 2
}
```
* **Response (200 OK)**:
```json
{
  "pushed": true,
  "detail": "portal responded 200",
  "count": 45
}
```

---

## 4. Student & Public Endpoints (Optional for Frontend Widgets)

If the college website wants to add a public live widget or embed student attendance check without API Key server-to-server calls:

### 1. Public Landing Statistics
* **Endpoint**: `GET /api/landing_stats`
* **Description**: Public high-level stats (Total Students, Active Classes, Today's Attendance count).
* **Response (200 OK)**:
```json
{
  "ok": true,
  "stats": {
    "total_students": 450,
    "active_classes": 12,
    "today_attendance": 380,
    "teachers": 25
  }
}
```

### 2. Public Active Classes List
* **Endpoint**: `GET /api/public_classes`
* **Response (200 OK)**: List of active classes for dropdowns.

---

## 5. Security & Deployment Requirements

1. **HTTPS Protocol Mandatory**: Face capture and webcam features require HTTPS.
2. **CORS Configuration**: If college web frontend calls APIs directly from browser JS, add the college domain (e.g. `https://college.edu`) to `CORS_ALLOWED_ORIGINS` in `.env`.
3. **API Key Confidentiality**: Keep `PORTAL_API_KEY` secret. Server-to-server calls must hide the key on backend logic, not client-side JS code.
