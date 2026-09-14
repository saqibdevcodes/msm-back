# Seed admin and user accounts

Add these settings to the backend `.env`, using your chosen email addresses and passwords:

```dotenv
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD="replace-with-your-admin-password"
SEED_USER_EMAIL=user@example.com
SEED_USER_PASSWORD="replace-with-your-user-password"
```

Optional display names: `SEED_ADMIN_NAME` and `SEED_USER_NAME`.

From `msm-back`, with dependencies installed and the database schema applied:

```sh
npm run build
npm run seed
```

The seed uses `DATABASE_URL`, creates two active accounts, and hashes passwords with the application's bcrypt helper. Both accounts are created in a single transaction. Running the seed again preserves existing accounts matched by email, including their passwords, roles, and status. The printed table shows the actual resulting account roles.

For a deployment with only compiled JavaScript and production dependencies, run:

```sh
node dist/prisma/seed.js
```
