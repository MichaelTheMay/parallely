---
title: Auth System
files:
  - src/auth/**
  - src/middleware/auth.ts
acceptance:
  - JWT login and register endpoints work
  - Auth middleware rejects requests without a valid token
  - Passwords are hashed with bcrypt
---

# Auth System

Implement JWT-based authentication for the API.

## Details

- `POST /auth/register` — create a user, hash the password with bcrypt, return a JWT.
- `POST /auth/login` — verify credentials, return a JWT.
- `src/middleware/auth.ts` — middleware that validates the `Authorization: Bearer` token
  and attaches `req.user`.
- Keep secrets in environment variables (`JWT_SECRET`).
