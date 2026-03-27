from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import httpx
import json
import uuid
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# --- Models ---
class UserCreate(BaseModel):
    email: str

class LocationUpdate(BaseModel):
    city: str = ""
    state: str = ""
    country: str = ""
    lat: float = 0.0
    lon: float = 0.0

class NotificationToggle(BaseModel):
    enabled: bool


# --- User Endpoints ---
@api_router.post("/users")
async def register_user(data: UserCreate):
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        return {"id": existing["id"], "email": existing["email"], "existing": True}
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": data.email,
        "location": None,
        "notifications_enabled": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user)
    return {"id": user_id, "email": data.email, "existing": False}


@api_router.patch("/users/{user_id}/location")
async def update_location(user_id: str, location: LocationUpdate):
    loc_dict = location.model_dump()
    result = await db.users.update_one({"id": user_id}, {"$set": {"location": loc_dict}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "location": loc_dict}


@api_router.patch("/users/{user_id}/notifications")
async def toggle_notifications(user_id: str, data: NotificationToggle):
    result = await db.users.update_one({"id": user_id}, {"$set": {"notifications_enabled": data.enabled}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "ok", "enabled": data.enabled}


@api_router.get("/users/{user_id}")
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# --- News Fetching ---
async def fetch_news(location: dict):
    news_api_key = os.environ.get('NEWS_API_KEY')
    if not news_api_key:
        return []
    country = (location.get('country', '') or 'India') if location else 'India'
    keywords = f"({country}) AND (fuel OR gas OR supply chain OR shortage OR prices OR crisis OR oil OR war)"
    try:
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            response = await http_client.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": keywords,
                    "language": "en",
                    "sortBy": "publishedAt",
                    "pageSize": 15,
                    "apiKey": news_api_key
                }
            )
            if response.status_code == 200:
                data = response.json()
                articles = data.get("articles", [])
                return [
                    {
                        "title": a.get("title", ""),
                        "description": a.get("description", ""),
                        "source": a.get("source", {}).get("name", ""),
                        "url": a.get("url", ""),
                        "published_at": a.get("publishedAt", ""),
                        "image": a.get("urlToImage", "")
                    }
                    for a in articles
                    if a.get("title") and "[Removed]" not in str(a.get("title", ""))
                ]
            else:
                logger.error(f"News API returned {response.status_code}: {response.text[:200]}")
    except Exception as e:
        logger.error(f"News API error: {e}")
    return []


# --- AI Analysis ---
async def analyze_with_ai(news_articles, location):
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        logger.error("No EMERGENT_LLM_KEY found")
        return None

    city = location.get('city', 'Unknown') if location else 'Unknown'
    state = location.get('state', '') if location else ''
    country = location.get('country', 'India') if location else 'India'
    location_str = ", ".join(filter(None, [city, state, country]))

    news_text = "\n".join([
        f"- {a['title']}: {a.get('description', 'No description')}"
        for a in news_articles[:10]
    ]) if news_articles else "No recent crisis-related news found for this region."

    prompt = f"""Analyze these recent news articles for {location_str} and create a crisis intelligence report.

NEWS ARTICLES:
{news_text}

Return ONLY valid JSON with this structure (no markdown, no code blocks):
{{
  "situation_summary": "One clear sentence about the current situation in this area",
  "smart_insight": "2-3 sentences explaining how global events are affecting daily life locally. Be specific about prices, availability, and services.",
  "price_analysis": {{
    "lpg": {{"current_price": 903, "change_percent": 2.1, "trend": "up"}},
    "petrol": {{"current_price": 104.61, "change_percent": 0.8, "trend": "up"}},
    "diesel": {{"current_price": 92.27, "change_percent": 0.5, "trend": "stable"}},
    "currency": "INR",
    "price_history": [
      {{"month": "Sep", "lpg": 870, "petrol": 101.2, "diesel": 89.5}},
      {{"month": "Oct", "lpg": 878, "petrol": 102.0, "diesel": 90.1}},
      {{"month": "Nov", "lpg": 885, "petrol": 102.8, "diesel": 90.8}},
      {{"month": "Dec", "lpg": 890, "petrol": 103.5, "diesel": 91.2}},
      {{"month": "Jan", "lpg": 896, "petrol": 104.0, "diesel": 91.8}},
      {{"month": "Feb", "lpg": 903, "petrol": 104.6, "diesel": 92.3}}
    ]
  }},
  "services": [
    {{"name": "Blinkit", "status": "Active", "note": "Normal operations"}},
    {{"name": "Zepto", "status": "Active", "note": "Normal operations"}},
    {{"name": "Swiggy Instamart", "status": "Active", "note": "Normal operations"}},
    {{"name": "BigBasket", "status": "Active", "note": "Normal operations"}}
  ],
  "demand_trends": [
    {{"product": "Induction Stoves", "demand": "High", "reason": "Alternative cooking solutions"}},
    {{"product": "Gas Cylinders", "demand": "High", "reason": "Supply concerns"}},
    {{"product": "Solar Panels", "demand": "Normal", "reason": "Steady interest"}},
    {{"product": "Batteries/UPS", "demand": "Normal", "reason": "Power backup"}}
  ],
  "panic_level": "Low",
  "panic_reason": "Brief explanation of current panic assessment",
  "alerts": [
    {{"message": "Alert message text", "severity": "info"}}
  ]
}}

Rules:
- Use realistic current prices for {country} in local currency
- Analyze the actual news to determine real panic levels and impacts
- If no significant crisis is found, honestly report stable conditions
- severity can be: "info", "warning", or "critical"
- status can be: "Active", "Limited", or "Stopped"
- demand can be: "Normal", "High", or "Sold Out"
- trend can be: "up", "down", or "stable"
"""

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"crisis-{uuid.uuid4()}",
            system_message="You are a crisis intelligence analyst. Return ONLY valid JSON with no markdown formatting or code blocks."
        ).with_model("gemini", "gemini-2.5-flash")

        response = await chat.send_message(UserMessage(text=prompt))
        response_text = str(response).strip()

        # Clean markdown code fences if present
        if "```" in response_text:
            lines = response_text.split("\n")
            cleaned = []
            in_block = False
            for line in lines:
                if line.strip().startswith("```"):
                    in_block = not in_block
                    continue
                cleaned.append(line)
            response_text = "\n".join(cleaned)

        return json.loads(response_text.strip())
    except json.JSONDecodeError as e:
        logger.error(f"AI JSON parse error: {e}")
        return None
    except Exception as e:
        logger.error(f"AI analysis error: {e}")
        return None


# --- Dashboard ---
@api_router.get("/dashboard/{user_id}")
async def get_dashboard(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    location = user.get("location") or {}

    # Check cache (15 min TTL)
    cache = await db.dashboard_cache.find_one({"user_id": user_id}, {"_id": 0})
    if cache:
        try:
            cached_time = datetime.fromisoformat(cache["updated_at"])
            if datetime.now(timezone.utc) - cached_time < timedelta(minutes=15):
                return cache["data"]
        except Exception:
            pass

    # Fetch fresh data
    news = await fetch_news(location)
    analysis = await analyze_with_ai(news, location)

    dashboard_data = {
        "location": location,
        "user": {
            "email": user.get("email", ""),
            "notifications_enabled": user.get("notifications_enabled", True)
        },
        "news": news[:8],
        "analysis": analysis,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    await db.dashboard_cache.update_one(
        {"user_id": user_id},
        {"$set": {
            "user_id": user_id,
            "data": dashboard_data,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )

    return dashboard_data


@api_router.post("/dashboard/refresh/{user_id}")
async def refresh_dashboard(user_id: str):
    await db.dashboard_cache.delete_one({"user_id": user_id})
    return await get_dashboard(user_id)


# --- Health Check ---
@api_router.get("/")
async def root():
    return {"message": "Crisis Intelligence API", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
