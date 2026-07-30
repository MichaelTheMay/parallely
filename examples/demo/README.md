# Demo plan — REST API

A ready-to-run Parallely plan that builds a small REST API (auth, CRUD, database,
tests) as four parallel sections. Use it to try Parallely end to end or to record a demo.

## Sections

| # | Section         | Scope                                            |
| - | --------------- | ------------------------------------------------ |
| 1 | Auth System     | JWT register/login + auth middleware             |
| 2 | CRUD Endpoints  | RESTful `notes` resource                         |
| 3 | Database Layer  | Models, migration, repository interface          |
| 4 | Tests           | Integration tests for the auth + CRUD flows      |

## Run it

From an empty git repository (so agents have a clean tree to work in):

```bash
git init my-api && cd my-api
cp -r /path/to/parallely/examples/demo/.parallely .

parallely validate      # sanity-check the plan
parallely run -b codex  # launch all four sections in parallel
```

> Sections 2–4 reference the auth layer from section 1. Parallely runs them
> concurrently in a shared worktree and auto-commits each to the integration branch;
> the demo is a good illustration of how overlapping work converges.
