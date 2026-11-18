# Budget Tracker

A monthly budgeting app for students and young adults: how much can I still spend this month, and am I spending it too fast?

One Go API, a React web app (installable on iPhone from Safari) and a native SwiftUI iOS app. All three share one contract: [`api/openapi.yaml`](api/openapi.yaml).

## Requirements

- Go 1.27 or later
- Node.js 20.19 or later
- Docker Desktop, running
- Xcode 27.1 or later, for the iOS app only

## First run

```sh
make setup      # web dependencies + Playwright browsers
make db-up      # PostgreSQL + Mailpit in Docker
make migrate    # create the tables
make db-seed    # demo accounts (below)
make backend    # API on http://localhost:8080   (keep running)
make web        # web app on http://localhost:5173 (in a second terminal)
```

Open http://localhost:5173 and sign in.

## Test accounts

`make db-seed` creates both accounts. It's safe to run again: each account is recreated from scratch.

| Sign in with | Password | What's inside |
| --- | --- | --- |
| `admin-test` (or `admin-test@budget-tracker.test`) | `AdminTest@123` | Realistic data for the last six months, ending today: three accounts (one in euro), budgets, subscriptions with one charge waiting for confirmation |
| `demo@budget-tracker.test` (username `demo`) | `budget-demo-2026` | November 2026, exactly as in the design mockups |

You can sign in with either the username or the email address.

## Email

Locally, every email the API sends goes to [Mailpit](https://mailpit.axllent.org), never to a real inbox. This covers email verification and password reset links. Open http://localhost:8025 to read them.

To send real email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `MAIL_FROM` in `backend/.env`. To print emails to the API log instead, set `MAIL_DRIVER=log`.

## Google sign-in

The "Sign in with Google" button appears only once a Google OAuth client id is configured. To set one up:

1. **Project.** Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project, or pick one.
2. **Consent screen.** Go to **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform** in newer consoles) and fill in:
   - **App name:** Budget Tracker.
   - **Support email:** your own.
   - **Audience:** External.
   - **Test users:** while the app is in *Testing*, add the Google accounts that should be able to sign in.
3. **Client id.** Go to **APIs & Services → Credentials → Create credentials → OAuth client ID** and fill in:
   - **Application type:** Web application.
   - **Name:** e.g. "Budget Tracker web (local)".
   - **Authorized JavaScript origins:** `http://localhost` and `http://localhost:5173`.
   - **Authorized redirect URIs:** leave empty. The web app uses Google Identity Services, which hands the ID token straight to the page.
4. **Configure the app.** Copy the client id (`…apps.googleusercontent.com`) into two files:
   - `backend/.env`: `GOOGLE_CLIENT_IDS=<client id>`
   - `web/.env.local`: `VITE_GOOGLE_CLIENT_ID=<client id>`
5. **Restart.** Restart `make backend` and `make web`.

**iOS.** Create a second OAuth client id with **Application type: iOS** and **Bundle ID** `com.andreipana.budgettracker`. Then:
   - add it to `GOOGLE_CLIENT_IDS` in `backend/.env`, comma-separated after the web one (the API accepts ID tokens issued to any listed client);
   - in Xcode, set two build settings on the BudgetTracker target: `GOOGLE_IOS_CLIENT_ID` = the iOS client id, and `GOOGLE_IOS_URL_SCHEME` = its reversed form (`com.googleusercontent.apps.…`, shown on the client's page in Google Cloud).

The app hides the Google button while `GOOGLE_IOS_CLIENT_ID` is empty.

**Account linking.** Signing in with Google using the same **verified** email as an existing account links Google to that account, so the person can then sign in either way. Otherwise a new account is created, with a username generated from the email address that can be changed in Settings.

## Commands

All commands run from the repo root. `make help` lists them.

| Command | What it does |
| --- | --- |
| `make setup` | Install the web dependencies and the Playwright browsers |
| `make db-up` / `make db-down` | Start / stop PostgreSQL and Mailpit (data is kept) |
| `make migrate` | Apply the database migrations |
| `make db-seed` | (Re)create the two test accounts |
| `make db-test` | Run the database integrity tests (rolled back; leaves no data) |
| `make backend` | Run the API on http://localhost:8080 |
| `make web` | Run the web app on http://localhost:5173 |
| `make generate` | Regenerate the Go server, the Go queries, the web types and the iOS client |
| `make test` | Backend unit + integration tests, web unit tests, web build |
| `make e2e` | Playwright end-to-end tests (Chromium and iPhone WebKit) |
| `make ios-test` | iOS logic tests (formatting, parsing, copy), run on the Mac |
| `make ios-build` | Build the iOS app for the simulator |

Settings for the API come from environment variables. The local defaults are at the top of the `Makefile`; override them in `backend/.env` (template: `backend/.env.example`). The web app reads `web/.env.local` (template: `web/.env.example`).

## How it fits together

- **API (`backend/`)**
  - Built with Go, chi, pgx and sqlc, on PostgreSQL 17.
  - Handlers are generated from the OpenAPI contract (oapi-codegen strict server).
  - Background jobs run inside the API process:
    - daily BNR exchange rates
    - pending charges for subscriptions that come due
    - cleanup of expired sessions and links
- **Web (`web/`)**
  - Built with React, TypeScript, Vite, Tailwind CSS v4 (design tokens in `web/src/styles/`), TanStack Query and React Router.
  - During development, `/api` is proxied to the Go API. Requests are then same-origin, so the HttpOnly refresh cookie works in every browser, Safari included.
- **Sign-in**
  - Uses short-lived access tokens (JWT, 15 minutes) plus a rotating refresh token per device.
  - The web app keeps the refresh token in an HttpOnly cookie. The iOS app keeps it in the Keychain.
- **iOS (`ios/`)**
  - A native SwiftUI app with the same screens as the web app's iPhone layout: sign-in, Home, Activity, Add, Budgets, Insights, Subscriptions and Settings.
  - It talks to the same Go API (so the same database) through the generated client in `ios/Packages/BudgetTrackerAPI`.
  - Formatting, parsing and copy live in `ios/Packages/BudgetTrackerCore`, tested with `make ios-test`.
  - Online only for now: there's no offline store until `GET /sync` exists.
