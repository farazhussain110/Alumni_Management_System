require("dotenv").config();

const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const uploadRoot = path.join(__dirname, "public", "uploads");
const documentRoot = path.join(uploadRoot, "documents");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
    name: "alumni.sid",
    secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 2
    }
}));

app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.notice = req.query.notice || "";
    res.locals.error = req.query.error || "";
    res.locals.formatDate = value => value ? new Date(value).toISOString().slice(0, 10) : "";
    next();
});

const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3308),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_NAME || "alumni_db",
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
});

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    } : undefined
}) : null;

async function sendEmail(message) {
    if (!mailer) {
        console.warn("SMTP is not configured. Email was not sent.");
        return false;
    }
    await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        ...message
    });
    return true;
}

async function ensureUploadFolders() {
    await fs.mkdir(uploadRoot, { recursive: true });
    await fs.mkdir(documentRoot, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(null, file.fieldname === "profile_image" ? uploadRoot : documentRoot);
    },
    filename: (req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + extension);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        const imageOk = [".jpg", ".jpeg", ".png", ".gif"].includes(extension) &&
            ["image/jpeg", "image/png", "image/gif"].includes(file.mimetype);
        const documentOk = [".pdf", ".doc", ".docx"].includes(extension) &&
            ["application/pdf", "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.mimetype);

        if (file.fieldname === "profile_image" && imageOk) return callback(null, true);
        if (file.fieldname === "resume" && documentOk) return callback(null, true);
        return callback(new Error("Invalid file type. Use an image for the profile photo and PDF/DOC/DOCX for the resume."));
    }
});

function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/login?error=Please%20log%20in%20first");
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).send("Access denied. Administrator login is required.");
    }
    next();
}

function removeUploadedFile(folder, filename) {
    if (!filename) return Promise.resolve();
    const safeName = path.basename(filename);
    return fs.unlink(path.join(folder, safeName)).catch(error => {
        if (error.code !== "ENOENT") console.error("Could not remove upload:", error.message);
    });
}

app.get("/", (req, res) => res.render("index"));
app.get("/contact", (req, res) => res.render("contact"));
app.get("/login", (req, res) => res.render("login"));

app.post("/contact", async (req, res) => {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !subject || !message) {
        return res.status(400).render("contact", { errorMessage: "Please complete every field." });
    }

    try {
        const sent = await sendEmail({
            to: process.env.CONTACT_TO || process.env.SMTP_USER,
            replyTo: email,
            subject: "Alumni website contact: " + subject,
            text: "From: " + name + " (" + email + ")\n\n" + message
        });
        res.render("contact", {
            successMessage: sent
                ? "Your message has been sent successfully."
                : "Your message was received, but email is not configured yet. Please ask the administrator to configure SMTP."
        });
    } catch (error) {
        console.error("Contact email error:", error.message);
        res.status(500).render("contact", { errorMessage: "The message could not be sent. Please try again later." });
    }
});

app.post("/register", upload.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "resume", maxCount: 1 }
]), async (req, res) => {
    const files = req.files || {};
    const profileImage = files.profile_image?.[0]?.filename || null;
    const resume = files.resume?.[0]?.filename || null;

    try {
        const {
            full_name, email, password, phone, dob, gender, department,
            graduation_year, cgpa, degree_program, employment_status,
            company, job_title, contact_preference, linkedin, bio
        } = req.body;

        if (!full_name || !email || !password || !req.body.terms_accepted) {
            return res.status(400).send("Name, email, password and acceptance of the terms are required.");
        }
        if (password.length < 8) {
            return res.status(400).send("Password must contain at least 8 characters.");
        }
        const [existing] = await db.execute("SELECT id FROM alumni WHERE email = ? LIMIT 1", [email.trim().toLowerCase()]);
        if (existing.length) {
            return res.status(409).send("An alumni account with this email already exists.");
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const skills = Array.isArray(req.body.skills)
            ? req.body.skills.join(", ")
            : (req.body.skills || "");

        const sql = "INSERT INTO alumni (full_name, email, password, phone, dob, gender, department, graduation_year, cgpa, degree_program, employment_status, company, job_title, skills, contact_preference, linkedin, bio, newsletter, terms_accepted, profile_image, resume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        const values = [
            full_name.trim(), email.trim().toLowerCase(), passwordHash, phone || null,
            dob || null, gender || null, department || null, graduation_year || null,
            cgpa || null, degree_program || null, employment_status || null,
            company || null, job_title || null, skills, contact_preference || null,
            linkedin || null, bio || null, req.body.newsletter ? 1 : 0, 1,
            profileImage, resume
        ];
        const [result] = await db.execute(sql, values);

        let emailSent = false;
        try {
            emailSent = await sendEmail({
                to: email.trim(),
                subject: "Alumni registration received",
                text: "Hello " + full_name + ",\n\nYour alumni registration has been received. Your registration ID is " + result.insertId + "."
            });
        } catch (mailError) {
            console.error("Registration email error:", mailError.message);
        }

        res.render("success", {
            name: full_name,
            id: result.insertId,
            profileImage,
            emailSent
        });
    } catch (error) {
        console.error("Registration error:", error);
        if (profileImage) await removeUploadedFile(uploadRoot, profileImage);
        if (resume) await removeUploadedFile(documentRoot, resume);
        res.status(500).send("Registration could not be completed. Please check the database configuration and try again.");
    }
});

app.post("/login", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    try {
        let user = null;

        if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
            email === process.env.ADMIN_EMAIL.trim().toLowerCase() &&
            password === process.env.ADMIN_PASSWORD) {
            user = { id: null, name: "Administrator", email, role: "admin" };
        } else {
            const [rows] = await db.execute(
                "SELECT id, full_name, email, password FROM alumni WHERE email = ? LIMIT 1",
                [email]
            );
            if (rows.length && await bcrypt.compare(password, rows[0].password)) {
                user = {
                    id: rows[0].id,
                    name: rows[0].full_name,
                    email: rows[0].email,
                    role: "alumni"
                };
            }
        }

        if (!user) return res.status(401).render("login", { errorMessage: "Invalid email or password." });

        await new Promise((resolve, reject) => {
            req.session.regenerate(error => error ? reject(error) : resolve());
        });
        req.session.user = user;
        res.redirect(user.role === "admin" ? "/admin" : "/profile");
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).render("login", { errorMessage: "Login is temporarily unavailable." });
    }
});

app.post("/logout", requireLogin, (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie("alumni.sid");
        res.redirect("/login?notice=You%20have%20logged%20out");
    });
});

app.get("/profile", requireLogin, async (req, res) => {
    if (req.session.user.role !== "alumni") return res.redirect("/admin");
    const [rows] = await db.execute(
        "SELECT id, full_name, email, phone, department, graduation_year, degree_program, employment_status, company, job_title, profile_image FROM alumni WHERE id = ?",
        [req.session.user.id]
    );
    if (!rows.length) return res.status(404).send("Alumni profile not found.");
    res.render("profile", { alumni: rows[0] });
});

app.get("/admin", requireAdmin, async (req, res) => {
    const [alumni] = await db.execute(
        "SELECT id, full_name, email, phone, department, graduation_year, employment_status, created_at FROM alumni ORDER BY created_at DESC"
    );
    res.render("dashboard", { alumni });
});

app.get("/admin/alumni/:id/edit", requireAdmin, async (req, res) => {
    const [rows] = await db.execute("SELECT * FROM alumni WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).send("Alumni record not found.");
    res.render("edit-alumni", { alumni: rows[0] });
});

app.post("/admin/alumni/:id/update", requireAdmin, upload.fields([
    { name: "profile_image", maxCount: 1 },
    { name: "resume", maxCount: 1 }
]), async (req, res) => {
    const [rows] = await db.execute("SELECT * FROM alumni WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).send("Alumni record not found.");
    const old = rows[0];
    const profileImage = req.files?.profile_image?.[0]?.filename || old.profile_image;
    const resume = req.files?.resume?.[0]?.filename || old.resume;

    try {
        const { full_name, email, phone, department, graduation_year, employment_status, company, job_title, linkedin, bio } = req.body;
        if (!full_name || !email) return res.status(400).send("Name and email are required.");

        const [duplicate] = await db.execute(
            "SELECT id FROM alumni WHERE email = ? AND id <> ? LIMIT 1",
            [email.trim().toLowerCase(), req.params.id]
        );
        if (duplicate.length) return res.status(409).send("Another alumni account already uses this email.");

        await db.execute(
            "UPDATE alumni SET full_name = ?, email = ?, phone = ?, department = ?, graduation_year = ?, employment_status = ?, company = ?, job_title = ?, linkedin = ?, bio = ?, profile_image = ?, resume = ? WHERE id = ?",
            [
                full_name.trim(), email.trim().toLowerCase(), phone || null,
                department || null, graduation_year || null, employment_status || null,
                company || null, job_title || null, linkedin || null, bio || null,
                profileImage, resume, req.params.id
            ]
        );

        if (profileImage !== old.profile_image) await removeUploadedFile(uploadRoot, old.profile_image);
        if (resume !== old.resume) await removeUploadedFile(documentRoot, old.resume);
        res.redirect("/admin?notice=Alumni%20record%20updated");
    } catch (error) {
        console.error("Update error:", error);
        if (profileImage !== old.profile_image) await removeUploadedFile(uploadRoot, profileImage);
        if (resume !== old.resume) await removeUploadedFile(documentRoot, resume);
        res.status(500).send("Could not update the alumni record.");
    }
});

app.post("/admin/alumni/:id/delete", requireAdmin, async (req, res) => {
    const [rows] = await db.execute("SELECT profile_image, resume FROM alumni WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).send("Alumni record not found.");
    await db.execute("DELETE FROM alumni WHERE id = ?", [req.params.id]);
    await removeUploadedFile(uploadRoot, rows[0].profile_image);
    await removeUploadedFile(documentRoot, rows[0].resume);
    res.redirect("/admin?notice=Alumni%20record%20deleted");
});

app.use((err, req, res, next) => {
    console.error(err);
    if (err instanceof multer.MulterError) {
        return res.status(400).send("Upload error: " + err.message + ". Maximum size is 2 MB per file.");
    }
    res.status(500).send(err.message || "An unexpected server error occurred.");
});

ensureUploadFolders()
    .then(() => db.query("SELECT 1"))
    .then(() => {
        app.listen(PORT, () => console.log("Alumni Management System running at http://localhost:" + PORT));
    })
    .catch(error => {
        console.error("Startup check failed:", error.message);
        console.error("Check MySQL is running and database.sql has been imported.");
        process.exit(1);
    });
