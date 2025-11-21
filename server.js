/**
 * Backend Server for Calendar MCP App
 * Dependencies: express, cors, dotenv, googleapis
 * * Install: npm install express cors dotenv googleapis
 * * Run: node server.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
const PORT = 3000;

// Enable CORS for Frontend
app.use(cors());
app.use(express.json());

// --- Configuration ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Frontend URL to redirect back to after login
const FRONTEND_URL = "http://localhost:5173";
const REDIRECT_URI = "http://localhost:3000/auth/callback";

// --- In-Memory Storage (For Demo) ---
// In production, store these in a database linked to a session ID
let userTokens = null;
let userProfile = null;

// --- OAuth 2.0 Setup ---
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// --- Routes ---

// 1. Login Endpoint
app.post("/auth/login", (req, res) => {
  // If keys are missing, fallback to mock mode
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.log("Missing credentials, returning mock user.");
    return res.json({
      authUrl: null,
      user: {
        name: "Mock User (No Creds)",
        email: "mock@local.dev",
        avatar: "https://ui-avatars.com/api/?name=Mock+User&background=random",
      },
    });
  }

  // If we already have tokens (simple single-user demo mode), just return the user
  if (userTokens && userProfile) {
    return res.json({ authUrl: null, user: userProfile });
  }

  // Generate the Google Login URL
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });

  // Send URL to frontend so it can redirect the user
  res.json({ authUrl: url, user: null });
});

// 2. OAuth Callback (Google redirects here)
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    userTokens = tokens; // Store in memory

    // Fetch basic profile info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    userProfile = {
      name: data.name,
      email: data.email,
      avatar: data.picture,
    };

    // Redirect back to the Frontend with success status
    res.redirect(`${FRONTEND_URL}?status=success`);
  } catch (error) {
    console.error("Error during callback:", error);
    res.status(500).send("Authentication failed. Check server console.");
  }
});

// 3. Fetch Meetings
app.get("/api/meetings", async (req, res) => {
  console.log("Fetching Google Calendar Events...");

  if (!userTokens) {
    // Return Mock Data if not authenticated
    return res.json({
      upcoming: [
        {
          id: "mock1",
          title: "Mock Meeting (Server)",
          startTime: new Date().toISOString(),
          endTime: new Date(Date.now() + 3600000).toISOString(),
          attendees: [],
          description: "Add valid credentials to .env to see real data.",
        },
      ],
      past: [],
    });
  }

  try {
    oauth2Client.setCredentials(userTokens);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last 7 days
      maxResults: 15,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items || [];
    const now = new Date();

    // Split into upcoming and past
    const upcoming = events
      .filter((e) => new Date(e.start.dateTime || e.start.date) > now)
      .map(transformEvent);
    const past = events
      .filter((e) => new Date(e.start.dateTime || e.start.date) <= now)
      .map(transformEvent);

    res.json({ upcoming, past });
  } catch (error) {
    console.error("Calendar API Error", error);
    // If token is invalid, we might want to clear it, but for simple demo just error out
    res.status(500).json({ error: "Failed to fetch calendar data" });
  }
});

// Helper to clean up event object
function transformEvent(e) {
  return {
    id: e.id,
    title: e.summary || "No Title",
    startTime: e.start.dateTime || e.start.date,
    endTime: e.end.dateTime || e.end.date,
    attendees: e.attendees || [],
    description: e.description,
    link: e.htmlLink,
  };
}

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
