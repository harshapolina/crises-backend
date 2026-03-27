require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function testGemini() {
    const apiKey = process.env.GEMINI_API_KEY;

    // Try multiple models to find one with available quota
    const models = ["gemini-2.0-flash-lite", "gemini-1.5-flash", "gemini-1.5-flash-8b"];

    for (const modelName of models) {
        try {
            console.log(`\nTesting model: ${modelName}...`);
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { responseMimeType: "application/json" },
            });

            const result = await model.generateContent("Return a JSON object with keys 'status' value 'ok' and 'model' value the model name you are.");
            const text = result.response.text();
            console.log(`SUCCESS with ${modelName}:`, text);
            return;
        } catch (err) {
            console.log(`FAILED ${modelName}: ${err.message.substring(0, 120)}`);
        }
    }
    console.log("\nAll models exhausted. You need to wait or add billing.");
}

testGemini();
