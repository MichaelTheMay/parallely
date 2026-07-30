---
title: Tests
files:
  - test/**
acceptance:
  - Auth flow is covered (register, login, protected route)
  - CRUD endpoints are covered including validation failures
  - Tests run green in CI
---

# Tests

Add an integration test suite for the API.

## Details

- Cover the auth flow end to end: register → login → call a protected route.
- Cover each CRUD endpoint, including a `400` validation-failure case.
- Keep tests hermetic (spin up the app in-process, use a throwaway database).
