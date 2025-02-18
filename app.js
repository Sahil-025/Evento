// Required packages
const mysql = require("mysql");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const session = require("express-session");
const { parse } = require("json2csv"); // Add this for CSV conversion

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use("/assets", express.static("assets"));
app.use(bodyParser.json()); // Add this to handle JSON requests

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Session middleware
app.use(
    session({
        secret: "your_secret_key", // Replace with your own secret key
        resave: false,
        saveUninitialized: true,
    })
);

// Create MySQL connection
const connection = mysql.createConnection({
    host: "",
    user: "",
    password: "", // Replace with your MySQL password
    database: "",
});

connection.connect((error) => {
    if (error) throw error;
    console.log("Connected to the database successfully");
});

// Create table dynamically for each event
function createEventTable(eventId) {
    const tableName = `event_${eventId}`;

    const query = `
        CREATE TABLE IF NOT EXISTS ${tableName} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            student_name VARCHAR(255),
            roll_no VARCHAR(255),
            prn_number VARCHAR(10) DEFAULT NULL,
            email VARCHAR(255),
            phone_number VARCHAR(15)
        )
    `;

    connection.query(query, (error) => {
        if (error) {
            console.error("Error creating event table: ", error);
        } else {
            console.log(`Table ${tableName} created or already exists.`);
        }
    });
}

// Serve login page
app.get("/", (req, res) => {
    res.sendFile(__dirname + "/views/index.html");
});

// Handle login POST request
app.post("/", (req, res) => {
    const { userType, username, password } = req.body;

    if (userType === "student") {
        req.session.username = "student"; // Set session for student
        res.redirect("/events"); // Redirect students to events page
    } else if (userType === "clubMember") {
        const query = "SELECT * FROM userlogin WHERE user_name = ? AND user_pass = ?";

        connection.query(query, [username, password], (error, results) => {
            if (error) {
                console.error("Error during login: ", error);
                return res.redirect("/");
            }

            if (results.length > 0) {
                req.session.username = username;
                res.redirect("/welcome");
            } else {
                res.redirect("/"); // Invalid login
            }
        });
    } else if (userType === "admin") {
        const query = "SELECT * FROM adminlogin WHERE admin_user_name = ? AND admin_pass = ?";

        connection.query(query, [username, password], (error, results) => {
            if (error) {
                console.error("Error during admin login: ", error);
                return res.redirect("/");
            }

            if (results.length > 0) {
                req.session.username = "admin"; // Admin login
                res.redirect("/adminDashboard");
            } else {
                res.redirect("/"); // Invalid admin login
            }
        });
    }
});

// Serve events page (visible to students, only approved events)
app.get("/events", (req, res) => {
    const username = req.session.username;

    if (!username) {
        return res.redirect("/"); // If not logged in, redirect to login page
    }

    const query = "SELECT * FROM events WHERE approved = true"; // Only approved events for students
    connection.query(query, (error, results) => {
        if (error) {
            console.error("Error fetching events: ", error);
            res.send("Error fetching events.");
        } else {
            res.render("events", { events: results }); // Pass events to the view
        }
    });
});

// Serve welcome page with events for Club Members
app.get("/welcome", (req, res) => {
    const username = req.session.username;

    if (!username) {
        return res.redirect("/"); // If not logged in, redirect to login page
    }

    const query = "SELECT * FROM events WHERE clubName = ?";
    connection.query(query, [username], (error, results) => {
        if (error) {
            console.error("Error fetching events: ", error);
            res.send("Error fetching events.");
        } else {
            res.render("welcome", { events: results, clubName: username });
        }
    });
});

// Handle event submission by club members (pending approval)
app.post("/addEvent", (req, res) => {
    const { eventName, eventDate, eventTime, venue, clubName, eventDescription } = req.body;
    const query = "INSERT INTO events (name, date, time, venue, clubName, eventDescription, approved) VALUES (?, ?, ?, ?, ?, ?, false)";

    connection.query(query, [eventName, eventDate, eventTime, venue, clubName, eventDescription], (error, results) => {
        if (error) {
            console.error("Error adding event: ", error);
            res.redirect("/welcome?status=error");
        } else {
            const eventId = results.insertId;
            createEventTable(eventId);
            res.redirect("/welcome");
        }
    });
});

// Admin dashboard with pending and approved events
app.get("/adminDashboard", (req, res) => {
    if (req.session.username !== "admin") return res.redirect("/");

    const pendingQuery = "SELECT * FROM events WHERE approved = false";
    const approvedQuery = "SELECT * FROM events WHERE approved = true";

    connection.query(pendingQuery, (error, pendingResults) => {
        if (error) {
            console.error("Error fetching pending events: ", error);
            return res.send("Error fetching pending events");
        }

        connection.query(approvedQuery, (error, approvedResults) => {
            if (error) {
                console.error("Error fetching approved events: ", error);
                return res.send("Error fetching approved events");
            }

            res.render("adminDashboard", {
                pendingEvents: pendingResults,
                approvedEvents: approvedResults,
            });
        });
    });
});

// Approve event
app.post("/approveEvent/:eventId", (req, res) => {
    const eventId = req.params.eventId;
    const query = "UPDATE events SET approved = true WHERE id = ?";

    connection.query(query, [eventId], (error) => {
        if (error) {
            console.error("Error approving event: ", error);
            return res.send("Error approving event.");
        }
        res.redirect("/adminDashboard");
    });
});

// Delete event (both pending and approved)
app.post("/deleteEvent/:eventId", (req, res) => {
    const eventId = req.params.eventId;

    // Delete associated registrations (if any)
    const deleteRegistrationsQuery = "DROP TABLE IF EXISTS event_" + eventId;
    connection.query(deleteRegistrationsQuery, (error) => {
        if (error) {
            console.error("Error deleting registrations table: ", error);
            return res.send("Error deleting registrations.");
        }

        // Delete the event itself
        const deleteEventQuery = "DELETE FROM events WHERE id = ?";
        connection.query(deleteEventQuery, [eventId], (error) => {
            if (error) {
                console.error("Error deleting event: ", error);
                return res.send("Error deleting event.");
            }
            res.redirect("/adminDashboard");
        });
    });
});

// Logout
app.get("/logout", (req, res) => {
    req.session.username = null;
    res.redirect("/");
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
