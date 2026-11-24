# Alumni Management System

A Node.js, Express, EJS and MySQL application for alumni registration and administration.

## Features

- Alumni registration with profile image and resume uploads.
- Password hashing with bcryptjs.
- SMTP registration confirmation emails.
- Contact form with SMTP email delivery.
- Login and logout with session management.
- Alumni users can view their own profile.
- Administrator dashboard with Create (registration), Read, Update and Delete operations.
- Administrator-only routes are protected by session and role checks.

## Requirements

- Node.js 18 or later
- MySQL / MariaDB (XAMPP is supported)
- SMTP account and credentials for outgoing email

## Setup

1. Clone or download this repository.
2. Install dependencies:

   \`\`\`bash
   npm install
   \`\`\`

3. Create the database by importing \`database.sql\` in phpMyAdmin or running it in MySQL.
4. Copy \`.env.example\` to \`.env\`.
5. Update the MySQL settings in \`.env\`. The default port is 3308 to match the original project setup; change it if your MySQL server uses another port.
6. Set a long random \`SESSION_SECRET\`.
7. Set a private \`ADMIN_EMAIL\` and \`ADMIN_PASSWORD\`.
8. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM and CONTACT_TO.
9. Start the application:

   \`\`\`bash
   npm start
   \`\`\`

10. Open http://localhost:3000.

## Main pages

- \`/\` — public alumni registration
- \`/contact\` — contact form (SMTP)
- \`/login\` — alumni or administrator login
- \`/profile\` — signed-in alumni profile
- \`/admin\` — administrator dashboard (protected)
- \`/admin/alumni/:id/edit\` — update an alumni record (protected)

## Authentication and sessions

Alumni passwords are stored as bcrypt hashes. The administrator account is configured through environment variables and must not be committed to Git. Login regenerates the session ID, logout destroys the session, and administrator CRUD routes check the session role.

The default Express session store is intended for local/lab use. For a production deployment, configure a persistent session store and HTTPS.

## SMTP

The registration form sends a confirmation email to the registering alumnus. The contact form sends its message to CONTACT_TO. If SMTP is not configured, the application displays a clear notice; configure the values in \`.env\` to enable delivery.

## CRUD

- Create: public registration form creates an alumni record.
- Read: administrator dashboard lists alumni; alumni can view their own profile.
- Update: administrator edits alumni details.
- Delete: administrator removes an alumni record and its uploaded files.

## Existing database note

The SQL script creates the current table if it does not exist. If you already have records created by the older version, their old plain-text passwords are not valid bcrypt hashes. Those users should reset/re-register their accounts before using alumni login. Back up your database before applying schema changes.
