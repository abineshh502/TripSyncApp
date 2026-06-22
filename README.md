# TripSync Monorepo 🌐

Welcome to the TripSync Monorepo! This repository is organized into a clean monorepo-style architecture, separating the mobile frontend application from the FastAPI core AI backend service.

## Directory Structure

```
root/
├── frontend/     # React Native / Expo Mobile Application
├── backend/      # FastAPI / Python Core AI Backend Service
├── docs/         # System Architecture & Documentation
└── README.md     # Monorepo Entrypoint (this file)
```

## Getting Started

### 📱 Frontend (Expo)

To start the Expo frontend application:

```bash
cd frontend
npm install
npx expo start
```

For more details, see [frontend/README.md](file:///c:/Users/konda/OneDrive/Desktop/app/frontend/README.md).

### ⚙️ Backend (FastAPI)

To start the FastAPI backend service:

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0
```

For more details, see [backend/README.md](file:///c:/Users/konda/OneDrive/Desktop/app/backend/README.md).

---

## Documentation

- [Architecture & Tech Stack](file:///c:/Users/konda/OneDrive/Desktop/app/docs/architecture.md)
- [Task Checklist](file:///c:/Users/konda/OneDrive/Desktop/app/docs/task.md)
- [Refactor Walkthrough](file:///c:/Users/konda/OneDrive/Desktop/app/docs/walkthrough.md)
