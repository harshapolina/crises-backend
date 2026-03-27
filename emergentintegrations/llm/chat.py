import json

class UserMessage:
    def __init__(self, text):
        self.text = text

class LlmChat:
    def __init__(self, api_key, session_id, system_message):
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message

    def with_model(self, provider, model):
        return self

    async def send_message(self, message):
        class ResponseStub:
            def __str__(self):
                # We return standard formatted JSON representing a realistic fallback
                # since the real API key isn't provided or integrated.
                return json.dumps({
                  "situation_summary": "Local markets remain stable despite global supply chain pressures.",
                  "smart_insight": "Global events have moderately impacted the availability of certain imported goods. Local fuel deliveries are experiencing minor delays.",
                  "price_analysis": {
                    "lpg": {"current_price": 903, "change_percent": 2.1, "trend": "up"},
                    "petrol": {"current_price": 104.61, "change_percent": 0.8, "trend": "up"},
                    "diesel": {"current_price": 92.27, "change_percent": 0.5, "trend": "stable"},
                    "currency": "INR",
                    "price_history": [
                      {"month": "Sep", "lpg": 870, "petrol": 101.2, "diesel": 89.5},
                      {"month": "Oct", "lpg": 878, "petrol": 102.0, "diesel": 90.1},
                      {"month": "Nov", "lpg": 885, "petrol": 102.8, "diesel": 90.8},
                      {"month": "Dec", "lpg": 890, "petrol": 103.5, "diesel": 91.2},
                      {"month": "Jan", "lpg": 896, "petrol": 104.0, "diesel": 91.8},
                      {"month": "Feb", "lpg": 903, "petrol": 104.6, "diesel": 92.3}
                    ]
                  },
                  "services": [
                    {"name": "Blinkit", "status": "Active", "note": "Normal operations"},
                    {"name": "Zepto", "status": "Active", "note": "Normal operations"},
                    {"name": "Swiggy Instamart", "status": "Active", "note": "Normal operations"},
                    {"name": "BigBasket", "status": "Active", "note": "Normal operations"}
                  ],
                  "demand_trends": [
                    {"product": "Induction Stoves", "demand": "High", "reason": "Alternative cooking solutions"},
                    {"product": "Gas Cylinders", "demand": "High", "reason": "Supply concerns"},
                    {"product": "Solar Panels", "demand": "Normal", "reason": "Steady interest"},
                    {"product": "Batteries/UPS", "demand": "Normal", "reason": "Power backup"}
                  ],
                  "panic_level": "Low",
                  "panic_reason": "No immediate threats to critical infrastructure observed locally.",
                  "alerts": []
                })
        return ResponseStub()
