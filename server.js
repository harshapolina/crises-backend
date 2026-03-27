const express = require("express");
const cors = require("cors");
const uuid = require("uuid");
require("dotenv").config();
const axios = require("axios");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const corsOrigin = process.env.CORS_ORIGINS || "*";
app.use(cors({ 
    origin: corsOrigin === "*" ? "*" : corsOrigin.split(","),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

// --- Initialize Gemini AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" },
});

// --- Gmail SMTP Transporter ---
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASS,
    },
});

// In-Memory Database
const DB = {
    users: new Map(),
    dashboard_cache: new Map(),
    location_cache: new Map(),
    otps: new Map()
};

// --- OTP Helpers ---
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, otp) {
    const html = [
        '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:500px;margin:0 auto;padding:30px;background:linear-gradient(135deg,#0f0f23,#1a1a3e);border-radius:12px;color:#fff;">',
        '<div style="text-align:center;margin-bottom:25px;">',
        '<h1 style="margin:0;font-size:24px;color:#00d4ff;">Crisis Intelligence</h1>',
        '<p style="color:#8892b0;font-size:13px;margin-top:5px;">Real-Time Local Crisis Dashboard</p>',
        '</div>',
        '<div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:25px;text-align:center;">',
        '<p style="color:#ccd6f6;font-size:15px;margin-top:0;">Your verification code is:</p>',
        '<div style="background:rgba(0,212,255,0.1);border:2px solid #00d4ff;border-radius:8px;padding:15px;margin:15px 0;">',
        '<span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#00d4ff;font-family:Courier New,monospace;">' + otp + '</span>',
        '</div>',
        '<p style="color:#8892b0;font-size:13px;">This code expires in <strong style="color:#ffcc00;">10 minutes</strong>.</p>',
        '</div>',
        '<p style="color:#4a5568;font-size:12px;text-align:center;margin-top:20px;">If you did not request this, please ignore this email.</p>',
        '</div>'
    ].join("");

    const info = await transporter.sendMail({
        from: '"Crisis Intelligence Dashboard" <' + process.env.GMAIL_USER + '>',
        to: email,
        subject: "Your Verification Code - Crisis Dashboard",
        html: html
    });
    console.log("[EMAIL] OTP sent to " + email + ". MessageId: " + info.messageId);
    return info;
}

// =============================================
// AUTH ENDPOINTS
// =============================================

// Step 1: Request OTP
app.post("/api/auth/request-otp", async function (req, res) {
    try {
        var email = req.body.email;
        if (!email) return res.status(400).json({ error: "Email is required" });

        var otp = generateOTP();
        var expires_at = Date.now() + 10 * 60 * 1000;
        DB.otps.set(email, { otp: otp, expires_at: expires_at });

        await sendOTPEmail(email, otp);
        return res.json({ status: "otp_sent", message: "Verification code sent to your email." });
    } catch (err) {
        console.error("[OTP] Error sending OTP:", err.message);
        res.status(500).json({ error: "Failed to send verification email. Please try again." });
    }
});

// Step 2: Verify OTP and create/login user
app.post("/api/auth/verify-otp", function (req, res) {
    try {
        var email = req.body.email;
        var otp = req.body.otp;
        if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

        var stored = DB.otps.get(email);
        if (!stored) return res.status(400).json({ error: "No OTP requested for this email." });
        if (Date.now() > stored.expires_at) {
            DB.otps.delete(email);
            return res.status(400).json({ error: "OTP has expired. Please request a new one." });
        }
        if (stored.otp !== otp) {
            return res.status(400).json({ error: "Invalid OTP. Please try again." });
        }

        DB.otps.delete(email);

        // Find or create user
        var existing = null;
        for (var u of DB.users.values()) {
            if (u.email === email) { existing = u; break; }
        }

        if (existing) {
            existing.verified = true;
            return res.json({ id: existing.id, email: existing.email, existing: true, verified: true });
        }

        var user_id = uuid.v4();
        var user = {
            id: user_id,
            email: email,
            verified: true,
            location: null,
            notifications_enabled: true,
            last_panic_level: "Low",
            created_at: new Date().toISOString()
        };
        DB.users.set(user_id, user);
        return res.json({ id: user_id, email: email, existing: false, verified: true });
    } catch (err) {
        console.error("[OTP] Verification error:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// =============================================
// USER ENDPOINTS
// =============================================

// Legacy create/login without OTP
app.post("/api/users", function (req, res) {
    try {
        var email = req.body.email;
        var existing = null;
        for (var u of DB.users.values()) {
            if (u.email === email) { existing = u; break; }
        }
        if (existing) {
            return res.json({ id: existing.id, email: existing.email, existing: true });
        }
        var user_id = uuid.v4();
        var user = {
            id: user_id,
            email: email,
            verified: false,
            location: null,
            notifications_enabled: true,
            last_panic_level: "Low",
            created_at: new Date().toISOString()
        };
        DB.users.set(user_id, user);
        return res.json({ id: user_id, email: email, existing: false });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.patch("/api/users/:user_id/location", function (req, res) {
    try {
        var user_id = req.params.user_id;
        var location = req.body;
        var user = DB.users.get(user_id);
        if (!user) return res.status(404).json({ detail: "User not found" });
        user.location = location;
        DB.users.set(user_id, user);
        return res.json({ status: "ok", location: location });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.patch("/api/users/:user_id/notifications", function (req, res) {
    try {
        var user_id = req.params.user_id;
        var enabled = req.body.enabled;
        var user = DB.users.get(user_id);
        if (!user) return res.status(404).json({ detail: "User not found" });
        user.notifications_enabled = enabled;
        DB.users.set(user_id, user);
        return res.json({ status: "ok", enabled: enabled });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get("/api/users/:user_id", function (req, res) {
    try {
        var user_id = req.params.user_id;
        var user = DB.users.get(user_id);
        if (!user) return res.status(404).json({ detail: "User not found" });
        return res.json(user);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// =============================================
// NEWS FETCHING
// =============================================

async function fetchNews(location) {
    var newsApiKey = process.env.NEWS_API_KEY;
    if (!newsApiKey) return [];

    var country = (location && location.country) || "India";
    var keywords = '"' + country + '" AND (war OR conflict OR military OR crisis OR strike)';

    try {
        var response = await axios.get("https://newsapi.org/v2/everything", {
            params: { q: keywords, language: "en", sortBy: "publishedAt", pageSize: 25, apiKey: newsApiKey },
            timeout: 15000
        });
        if (response.status === 200) {
            return response.data.articles
                .filter(function (a) { return a.title && !a.title.includes("[Removed]"); })
                .filter(function (a) {
                    var text = (a.title + " " + (a.description || "")).toLowerCase();
                    return text.includes("war") || text.includes("conflict") || text.includes("military") || text.includes("strike") || text.includes("crisis") || text.includes("missile") || text.includes("attack");
                })
                .map(function (a) {
                    return {
                        title: a.title || "",
                        description: a.description || "",
                        source: (a.source && a.source.name) || "",
                        url: a.url || "",
                        published_at: a.publishedAt || "",
                        image: a.urlToImage || ""
                    };
                }).slice(0, 15);
        }
    } catch (err) {
        console.error("News API Error:", err.message);
    }
    return [];
}

// =============================================
// AI-POWERED ANALYSIS (Gemini + Heuristic Fallback)
// =============================================

async function callGeminiWithRetry(prompt, maxRetries) {
    maxRetries = maxRetries || 1;
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            var result = await geminiModel.generateContent(prompt);
            return result.response.text();
        } catch (err) {
            var is429 = err.message && err.message.includes("429");
            if (is429 && attempt < maxRetries) {
                var waitSec = (attempt + 1) * 15;
                console.log("[AI] Rate limited (429). Retrying in " + waitSec + "s...");
                await new Promise(function (r) { setTimeout(r, waitSec * 1000); });
            } else {
                throw err;
            }
        }
    }
}

async function analyzeWithAi(newsArticles, location) {
    var emptyFallback = {
        situation_summary: "SYSTEM PAUSED: No crisis news detected in your area.",
        smart_insight: "We are actively monitoring global and regional channels for disruptions.",
        price_analysis: {
            lpg: { current_price: 0, change_percent: 0, trend: "stable" },
            petrol: { current_price: 0, change_percent: 0, trend: "stable" },
            diesel: { current_price: 0, change_percent: 0, trend: "stable" },
            currency: "INR",
            price_history: []
        },
        services: [{ name: "Blinkit, Zepto, Swiggy", status: "Active", note: "All apps operating normally." }],
        demand_trends: [{ product: "All Categories", demand: "Normal", reason: "No panic buying observed." }],
        panic_level: "Low",
        panic_reason: "Zero active conflict news detected locally.",
        alerts: [{ message: "All regional supply lines are currently clear.", severity: "info" }]
    };

    if (!newsArticles || newsArticles.length === 0) {
        return emptyFallback;
    }

    var country = (location && location.country) || (location && location.city) || "India";
    var city = (location && location.city) || "Unknown City";

    // --- PRIMARY: Gemini AI ---
    try {
        var articlesText = newsArticles.map(function (a, i) {
            return (i + 1) + ". [" + a.source + '] "' + a.title + '" - ' + a.description;
        }).join("\n");

        var prompt = 'You are a real-time Crisis Intelligence Analyst AI.\n\n' +
            'LOCATION: ' + country + ', ' + city + '\n' +
            'DATE: ' + new Date().toISOString() + '\n\n' +
            'LIVE NEWS:\n' + articlesText + '\n\n' +
            'Generate a JSON crisis dashboard report. Use REAL current fuel prices for ' + country + '. ' +
            'Mention REAL apps (Blinkit, Zepto, Swiggy, PharmEasy, Apollo247). ' +
            'List 3-5 demand trend categories. Generate 2-4 alerts from the news.\n\n' +
            'Return ONLY valid JSON:\n' +
            '{\n' +
            '  "situation_summary": "1-2 sentence summary",\n' +
            '  "smart_insight": "2-3 sentence actionable insight",\n' +
            '  "price_analysis": {\n' +
            '    "lpg": { "current_price": number, "change_percent": number, "trend": "up|down|stable" },\n' +
            '    "petrol": { "current_price": number, "change_percent": number, "trend": "up|down|stable" },\n' +
            '    "diesel": { "current_price": number, "change_percent": number, "trend": "up|down|stable" },\n' +
            '    "currency": "INR",\n' +
            '    "price_history": [{ "time": "string", "lpg": number, "petrol": number, "diesel": number }]\n' +
            '  },\n' +
            '  "services": [{ "name": "string", "status": "Active|Limited|Suspended", "note": "string" }],\n' +
            '  "demand_trends": [{ "product": "string", "demand": "Normal|Elevated|High|Critical", "reason": "string" }],\n' +
            '  "panic_level": "Low|Medium|High",\n' +
            '  "panic_reason": "string",\n' +
            '  "alerts": [{ "message": "string", "severity": "info|warning|critical" }]\n' +
            '}';

        console.log("[AI] Sending analysis to Gemini...");
        var responseText = await callGeminiWithRetry(prompt);
        var aiData = JSON.parse(responseText);
        console.log("[AI] Gemini analysis complete. Panic Level: " + aiData.panic_level);
        return aiData;
    } catch (aiError) {
        console.error("[AI] Gemini failed, using heuristic: " + (aiError.message || "").substring(0, 100));
    }

    // --- FALLBACK: Enhanced Heuristic ---
    console.log("[HEURISTIC] Generating dynamic analysis from news...");
    var textBlob = newsArticles.map(function (a) { return (a.title + " " + (a.description || "")).toLowerCase(); }).join(" ");
    var sources = [];
    var sourceSet = {};
    newsArticles.forEach(function (a) {
        if (a.source && !sourceSet[a.source]) {
            sourceSet[a.source] = true;
            sources.push(a.source);
        }
    });
    var now = new Date();

    var severeWords = (textBlob.match(/attack|bomb|missile|casualties|killed|destroy|invasion|nuclear/g) || []).length;
    var panicWords = (textBlob.match(/panic|crisis|war|conflict|shortage|block|suspend|escalat|threat|strike/g) || []).length;
    var totalScore = severeWords * 2 + panicWords;

    var panicLevel, panicReason;
    if (totalScore > 12) {
        panicLevel = "High";
        panicReason = "Critical: " + severeWords + " severe indicators and " + panicWords + " disruption signals from " + sources.slice(0, 3).join(", ") + ".";
    } else if (totalScore > 4) {
        panicLevel = "Medium";
        panicReason = "Elevated: " + panicWords + " disruption signals from " + sources.length + " sources.";
    } else {
        panicLevel = "Low";
        panicReason = "Routine: " + newsArticles.length + " articles scanned. No immediate threat.";
    }

    var hasFuelKeywords = textBlob.includes("price") || textBlob.includes("fuel") || textBlob.includes("oil") || textBlob.includes("crude");
    var hasSupplyKeywords = textBlob.includes("supply") || textBlob.includes("shortage") || textBlob.includes("strait") || textBlob.includes("hormuz");

    var dayVar = (now.getDate() % 5) * 0.3;
    var crisisMult = panicLevel === "High" ? 1.04 : (panicLevel === "Medium" ? 1.015 : 1.0);
    var fuelMult = (hasFuelKeywords || hasSupplyKeywords) ? 1.02 : 1.0;

    var petrolPrice = +(103.5 * crisisMult * fuelMult + dayVar).toFixed(1);
    var dieselPrice = +(90.5 * crisisMult * fuelMult + dayVar * 0.8).toFixed(1);
    var lpgPrice = +(903 * crisisMult * fuelMult + dayVar * 3).toFixed(0);

    var petrolChange = +((petrolPrice / 103.5 - 1) * 100).toFixed(1);
    var dieselChange = +((dieselPrice / 90.5 - 1) * 100).toFixed(1);
    var lpgChange = +((lpgPrice / 903 - 1) * 100).toFixed(1);

    var priceHistory = ["06:00 AM", "08:00 AM", "10:00 AM", "12:00 PM", "02:00 PM", "04:00 PM"].map(function (time, i) {
        var f = 1 + (i * petrolChange / 100 / 5);
        return {
            time: time,
            lpg: +(903 * (1 + i * lpgChange / 100 / 5)).toFixed(0),
            petrol: +(103.5 * f).toFixed(1),
            diesel: +(90.5 * (1 + i * dieselChange / 100 / 5)).toFixed(1)
        };
    });

    var topHeadline = (newsArticles[0] && newsArticles[0].title) || "Ongoing situation";
    var situationSummary = panicLevel === "High"
        ? "CRITICAL: " + newsArticles.length + " conflict reports. Lead: " + topHeadline.substring(0, 70)
        : panicLevel === "Medium"
            ? "ELEVATED: " + newsArticles.length + " articles across " + sources.length + " sources."
            : "ROUTINE: " + newsArticles.length + " articles monitored. No local impact.";

    var smartInsight = panicLevel === "High"
        ? "Multiple conflict reports from " + sources.slice(0, 3).join(", ") + " indicate supply chain disruptions in " + country + ". Quick-commerce may see stock-outs within 12-24 hours."
        : panicLevel === "Medium"
            ? "Regional instability signals from " + sources.length + " sources. Fuel prices show upward pressure. Monitor delivery apps."
            : "No immediate infrastructure threats in " + country + ". Supply chains and fuel networks remain intact.";

    var alerts = [];
    if (panicLevel === "High") {
        alerts.push({ message: "CRITICAL: " + topHeadline.substring(0, 80), severity: "critical" });
        alerts.push({ message: "Quick-commerce platforms may report delays. Stock essentials.", severity: "warning" });
        if (hasSupplyKeywords) alerts.push({ message: "Fuel supply disruptions possible. Fill up vehicles.", severity: "warning" });
    } else if (panicLevel === "Medium") {
        alerts.push({ message: "Monitoring: " + topHeadline.substring(0, 80), severity: "warning" });
        alerts.push({ message: newsArticles.length + " conflict reports from " + sources.length + " sources.", severity: "info" });
    } else {
        alerts.push({ message: "No critical alerts for your zone today.", severity: "info" });
        alerts.push({ message: "Monitoring " + newsArticles.length + " articles from " + sources.slice(0, 3).join(", ") + ".", severity: "info" });
    }

    return {
        situation_summary: situationSummary,
        smart_insight: smartInsight,
        price_analysis: {
            lpg: { current_price: lpgPrice, change_percent: lpgChange, trend: lpgChange > 0.5 ? "up" : "stable" },
            petrol: { current_price: petrolPrice, change_percent: petrolChange, trend: petrolChange > 0.5 ? "up" : "stable" },
            diesel: { current_price: dieselPrice, change_percent: dieselChange, trend: dieselChange > 0.5 ? "up" : "stable" },
            currency: "INR",
            price_history: priceHistory
        },
        services: [
            { name: "Blinkit & Zepto", status: panicLevel === "High" ? "Limited" : "Active", note: panicLevel === "High" ? "Delays and stock-outs on essentials." : "Standard delivery active." },
            { name: "Swiggy Instamart", status: panicLevel === "High" ? "Limited" : "Active", note: panicLevel === "High" ? "Surge pricing active." : "Full catalogue available." },
            { name: "PharmEasy & Apollo247", status: "Active", note: panicLevel === "High" ? "Increased demand for first-aid kits." : "All pharmacy services operational." },
            { name: "Public Transport", status: panicLevel === "High" ? "Limited" : "Active", note: panicLevel === "High" ? "Some routes suspended." : "Normal schedules." }
        ],
        demand_trends: [
            { product: "Bottled Water & Canned Food", demand: panicLevel === "High" ? "Critical" : (panicLevel === "Medium" ? "Elevated" : "Normal"), reason: panicLevel === "Low" ? "No unusual demand." : "Stockpiling triggered by " + newsArticles.length + " reports." },
            { product: "Emergency Medical Kits", demand: panicLevel === "High" ? "High" : "Elevated", reason: "High priority during uncertainty." },
            { product: "Power Banks & Inverters", demand: panicLevel === "High" ? "High" : "Normal", reason: panicLevel === "High" ? "Grid instability concerns." : "Standard demand." },
            { product: "Fuel (Petrol/Diesel)", demand: hasFuelKeywords ? "High" : "Normal", reason: hasFuelKeywords ? "Crude oil concerns." : "Normal refueling." },
            { product: "Cooking Gas (LPG)", demand: panicLevel === "High" ? "Critical" : "Normal", reason: panicLevel === "High" ? "Import disruption risk." : "Regular cycle." }
        ],
        panic_level: panicLevel,
        panic_reason: panicReason,
        alerts: alerts
    };
}

// =============================================
// DASHBOARD API
// =============================================

app.get("/api/dashboard/:user_id", async function (req, res) {
    try {
        var user_id = req.params.user_id;
        var user = DB.users.get(user_id);
        if (!user) return res.status(404).json({ detail: "User not found" });

        var location = user.location || {};

        var cache = DB.dashboard_cache.get(user_id);
        if (cache) {
            var cachedTime = new Date(cache.updated_at).getTime();
            if (Date.now() - cachedTime < 15 * 60 * 1000) {
                return res.json(cache.data);
            }
        }

        var news = await fetchNews(location);
        var analysis = await analyzeWithAi(news, location);

        var dashboard_data = {
            location: location,
            user: { email: user.email || "", notifications_enabled: user.notifications_enabled !== false },
            news: news.slice(0, 8),
            analysis: analysis,
            updated_at: new Date().toISOString()
        };

        DB.dashboard_cache.set(user_id, { data: dashboard_data, updated_at: new Date().toISOString() });
        return res.json(dashboard_data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post("/api/dashboard/refresh/:user_id", async function (req, res) {
    try {
        var user_id = req.params.user_id;
        DB.dashboard_cache.delete(user_id);
        // Re-fetch fresh data
        var user = DB.users.get(user_id);
        if (!user) return res.status(404).json({ detail: "User not found" });

        var location = user.location || {};
        var news = await fetchNews(location);
        var analysis = await analyzeWithAi(news, location);

        var dashboard_data = {
            location: location,
            user: { email: user.email || "", notifications_enabled: user.notifications_enabled !== false },
            news: news.slice(0, 8),
            analysis: analysis,
            updated_at: new Date().toISOString()
        };
        DB.dashboard_cache.set(user_id, { data: dashboard_data, updated_at: new Date().toISOString() });
        return res.json(dashboard_data);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// =============================================
// SEND SUMMARY EMAIL TO ALL REGISTERED USERS
// =============================================

async function sendHourlyCrisisUpdates() {
    console.log("[CRON] Starting hourly crisis updates to all users...");
    var sentCount = 0;
    var errors = [];
    var localLocationCache = new Map(); // Cache results for this specific run

    for (var user of DB.users.values()) {
        if (!user.email || !user.notifications_enabled || !user.location) continue;

        try {
            var loc = user.location || {};
            var locKey = (loc.city || "") + "_" + (loc.country || "General");
            
            var analysisData;
            var cached = DB.location_cache.get(locKey);
            var isFresh = cached && (Date.now() - new Date(cached.updated_at).getTime() < 15 * 60 * 1000);

            if (isFresh) {
                analysisData = cached.data;
            } else if (localLocationCache.has(locKey)) {
                analysisData = localLocationCache.get(locKey);
            } else {
                console.log("[CRON] Fetching fresh analysis for: " + locKey);
                var news = await fetchNews(loc);
                var analysis = await analyzeWithAi(news, loc);
                analysisData = { news: news, analysis: analysis };
                localLocationCache.set(locKey, analysisData);
                DB.location_cache.set(locKey, { data: analysisData, updated_at: new Date().toISOString() });
            }

            var news = analysisData.news;
            var analysis = analysisData.analysis;
            var borderCol = analysis.panic_level === "High" ? "#ff3b30" : (analysis.panic_level === "Medium" ? "#ffcc00" : "#34c759");

            var newsHtml = news.slice(0, 5).map(function (n) {
                return '<li style="margin-bottom:10px;color:#a8b2d1;"><a href="' + n.url + '" style="color:#00d4ff;text-decoration:none;">' + n.title + '</a><br/><span style="font-size:12px;color:#666;">' + n.source + '</span></li>';
            }).join("");

            var demandHtml = (analysis.demand_trends || []).map(function (d) {
                var color = d.demand === "Critical" ? "#ff3b30" : (d.demand === "High" ? "#ffcc00" : (d.demand === "Elevated" ? "#ff9f43" : "#34c759"));
                return '<tr><td style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);color:#ccd6f6;">' + d.product + '</td><td style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);color:' + color + ';font-weight:bold;">' + d.demand + '</td><td style="padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);color:#8892b0;font-size:12px;">' + d.reason + '</td></tr>';
            }).join("");

            var servicesHtml = (analysis.services || []).map(function (s) {
                var statusColor = s.status === "Active" ? "#34c759" : (s.status === "Limited" ? "#ffcc00" : "#ff3b30");
                return '<tr><td style="padding:6px;color:#ccd6f6;">' + s.name + '</td><td style="padding:6px;color:' + statusColor + ';font-weight:bold;">' + s.status + '</td><td style="padding:6px;color:#8892b0;font-size:12px;">' + s.note + '</td></tr>';
            }).join("");

            var alertsHtml = (analysis.alerts || []).map(function (a) {
                var alertColor = a.severity === "critical" ? "#ff3b30" : (a.severity === "warning" ? "#ffcc00" : "#34c759");
                return '<li style="margin-bottom:6px;color:' + alertColor + ';">' + a.message + '</li>';
            }).join("");

            var emailHtml = [
                '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:650px;margin:0 auto;padding:25px;background:linear-gradient(135deg,#0f0f23,#1a1a3e);border-radius:12px;color:#e6e6e6;border:1px solid ' + borderCol + ';">',
                '<div style="text-align:center;margin-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:15px;">',
                '<h1 style="margin:0;font-size:22px;color:#00d4ff;">Crisis Intelligence Dashboard</h1>',
                '<p style="color:#8892b0;font-size:12px;margin-top:5px;">Hourly Crisis Update - ' + new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + ' ' + new Date().toLocaleTimeString("en-IN") + '</p>',
                '</div>',
                '<div style="text-align:center;margin:15px 0;">',
                '<div style="display:inline-block;background:rgba(255,255,255,0.05);border:2px solid ' + borderCol + ';border-radius:8px;padding:12px 30px;">',
                '<span style="font-size:11px;color:#8892b0;text-transform:uppercase;letter-spacing:2px;">Threat Level</span><br/>',
                '<span style="font-size:32px;font-weight:bold;color:' + borderCol + ';">' + (analysis.panic_level || "LOW").toUpperCase() + '</span>',
                '</div></div>',
                '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:15px;margin:15px 0;">',
                '<h3 style="color:#00d4ff;font-size:14px;margin:0 0 8px 0;">Situation Summary</h3>',
                '<p style="color:#ccd6f6;font-size:14px;margin:0;line-height:1.5;">' + (analysis.situation_summary || "Monitoring ongoing situation.") + '</p>',
                '</div>',
                '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:15px;margin:15px 0;">',
                '<h3 style="color:#00d4ff;font-size:14px;margin:0 0 8px 0;">Intelligence Insight</h3>',
                '<p style="color:#a8b2d1;font-size:13px;margin:0;line-height:1.5;">' + (analysis.smart_insight || "Maintain operational readiness.") + '</p>',
                '</div>',
                '<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:15px;margin:15px 0;">',
                '<h3 style="color:#00d4ff;font-size:14px;margin:0 0 10px 0;">Service Status</h3>',
                '<table style="width:100%;border-collapse:collapse;">' + (servicesHtml || "<tr><td>All clear.</td></tr>") + '</table></div>',
                '<hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:20px 0;"/>',
                '<p style="font-size:11px;color:#4a5568;text-align:center;">Crisis Intelligence Dashboard - Automated Hourly Summary<br/>',
                'You received this because you are a registered user.</p>',
                '</div>'
            ].join("");

            await transporter.sendMail({
                from: '"Crisis Intelligence Dashboard" <' + process.env.GMAIL_USER + '>',
                to: user.email,
                subject: "CRISIS UPDATE: Threat Level " + (analysis.panic_level || "LOW").toUpperCase() + " in " + (loc.city || "your area"),
                html: emailHtml
            });

            sentCount++;
            // Small stagger to avoid rate limits
            await new Promise(function (r) { setTimeout(r, 600); });
        } catch (userErr) {
            console.error("[CRON] Error for " + user.email + ": " + userErr.message);
            errors.push({ email: user.email, error: userErr.message });
        }
    }
    console.log("[CRON] Hourly updates complete. Sent: " + sentCount + ", Errors: " + errors.length);
    return { sent: sentCount, errors: errors };
}

app.post("/api/email/send-summary", async function (req, res) {
    try {
        const result = await sendHourlyCrisisUpdates();
        return res.json({
            status: "done",
            sent: result.sent,
            total_users: DB.users.size,
            errors: result.errors
        });
    } catch (err) {
        console.error("[EMAIL] Summary send error:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get("/api/", function (req, res) {
    res.json({ message: "Crisis Intelligence API", status: "ok" });
});

// =============================================
// BACKGROUND ALERT DAEMON (Gmail)
// =============================================

function startAlertDaemon() {
    console.log("[DAEMON] Crisis alert monitoring started (30s interval)");

    setInterval(async function () {
        for (var user of DB.users.values()) {
            if (user.notifications_enabled && user.location) {
                try {
                    var news = await fetchNews(user.location);
                    var analysis = await analyzeWithAi(news, user.location);

                    var currentLevel = analysis.panic_level;
                    var previousLevel = user.last_panic_level || "Low";

                    if (currentLevel !== previousLevel) {
                        console.log("[DAEMON] Panic shift for " + user.email + ": " + previousLevel + " -> " + currentLevel);

                        var criticalItems = analysis.demand_trends
                            .filter(function (d) { return d.demand !== "Normal"; })
                            .map(function (d) { return '<li style="font-size:14px;margin-bottom:8px;"><b>' + d.product + '</b>: ' + d.demand + '<br/><span style="color:#666;font-size:12px;">(' + d.reason + ')</span></li>'; })
                            .join("");

                        var activeAlerts = analysis.alerts
                            .map(function (a) { return '<li style="font-size:14px;margin-bottom:8px;color:' + (a.severity === "critical" ? "#ff3b30" : "#333") + ';">' + a.message + '</li>'; })
                            .join("");

                        var borderCol = currentLevel === "High" ? "#ff3b30" : (currentLevel === "Medium" ? "#ffcc00" : "#34c759");
                        var cityName = (user.location && user.location.city) || "your area";

                        var alertHtml = [
                            '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:25px;background:linear-gradient(135deg,#0f0f23,#1a1a3e);border:2px solid ' + borderCol + ';border-radius:12px;color:#e6e6e6;">',
                            '<div style="text-align:center;margin-bottom:20px;">',
                            '<h1 style="margin:0;font-size:22px;color:' + borderCol + ';">Crisis Intelligence Update</h1></div>',
                            '<p style="font-size:15px;color:#ccd6f6;">Disruption shift detected in <strong style="color:#fff;">' + cityName + '</strong>.</p>',
                            '<div style="background:rgba(255,255,255,0.05);border:1px solid ' + borderCol + ';border-radius:8px;padding:15px;margin:15px 0;text-align:center;">',
                            '<span style="font-size:13px;color:#8892b0;text-transform:uppercase;letter-spacing:2px;">Alert Status</span><br/>',
                            '<span style="font-size:28px;font-weight:bold;color:' + borderCol + ';">' + currentLevel.toUpperCase() + '</span>',
                            '<span style="font-size:14px;color:#8892b0;"> (was: ' + previousLevel + ')</span></div>',
                            '<p style="color:#a8b2d1;line-height:1.6;font-size:14px;">' + analysis.smart_insight + '</p>',
                            '<h3 style="color:#ccd6f6;font-size:14px;margin-bottom:8px;">High Demand Items</h3>',
                            '<ul style="margin-top:0;padding-left:20px;color:#a8b2d1;">' + (criticalItems || "<li>No shortages detected.</li>") + '</ul>',
                            '<h3 style="color:#ccd6f6;font-size:14px;margin-bottom:8px;">Active Alerts</h3>',
                            '<ul style="margin-top:0;padding-left:20px;color:#a8b2d1;">' + (activeAlerts || "<li>All clear.</li>") + '</ul>',
                            '<hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:20px 0;"/>',
                            '<p style="font-size:11px;color:#4a5568;text-align:center;">You opted-in to Live Crisis Tracking.</p>',
                            '</div>'
                        ].join("");

                        try {
                            await transporter.sendMail({
                                from: '"Crisis Intelligence Tracker" <' + process.env.GMAIL_USER + '>',
                                to: user.email,
                                subject: "CRISIS ALERT: Status shifted to " + currentLevel + " in " + cityName,
                                html: alertHtml
                            });
                            console.log("[DAEMON] Alert email sent to " + user.email);
                        } catch (mailErr) {
                            console.error("[DAEMON] Mail failed for " + user.email + ": " + mailErr.message);
                        }

                        user.last_panic_level = currentLevel;
                        DB.users.set(user.id, user);
                    }
                } catch (err) {
                    console.error("[DAEMON] Error for " + user.email + ": " + err.message);
                }
            }
        }
    }, 30000);
}

// =============================================
// START SERVER
// =============================================

var PORT = process.env.PORT || 5005;
app.listen(PORT, function () {
    console.log("Server API Engine running on port " + PORT);
    console.log("Gmail Transporter: " + process.env.GMAIL_USER);
    
    // Start Alert Daemon (Panic Shift)
    startAlertDaemon();

    // Start Hourly Updates (Cron)
    // Runs at the start of every hour: 0 * * * *
    cron.schedule("0 * * * *", function() {
        sendHourlyCrisisUpdates();
    });
    console.log("[CRON] Scheduled hourly crisis updates.");
});
