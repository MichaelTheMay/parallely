---
title: CRUD Endpoints
files:
  - src/routes/**
  - src/controllers/**
acceptance:
  - Full CRUD for the `notes` resource
  - Input is validated and errors return 400 with a message
  - Protected routes require a valid JWT
---

# CRUD Endpoints

Build RESTful CRUD endpoints for a `notes` resource.

## Details

- `GET /notes`, `GET /notes/:id`, `POST /notes`, `PATCH /notes/:id`, `DELETE /notes/:id`.
- Validate request bodies; return `400` with a helpful message on bad input.
- All routes require authentication (reuse the auth middleware).
