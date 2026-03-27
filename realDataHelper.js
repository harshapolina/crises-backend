const axios = require('axios');
const cheerio = require('cheerio');
const googleTrends = require('google-trends-api');

// Fetch Service Uptime (Ping the URL)
async function checkServiceStatus(url) {
    try {
        const start = Date.now();
        const response = await axios.get(url, { timeout: 5000 });
        const latency = Date.now() - start;
        if (response.status === 200 || response.status === 403) {
            if (latency > 3000) return { available: true, status: 'Limited' };
            return { available: true, status: 'Active' };
        }
        return { available: true, status: 'Stopped' };
    } catch (error) {
        if (error.response && error.response.status === 403) {
            // 403 usually means Cloudflare/Bot protection, so the site is UP
            return { available: true, status: 'Active' };
        }
        return { available: true, status: 'Stopped' };
    }
}

// Scrape fuel prices (Requires a generalized approach or specific URLs)
// GoodReturns format: https://www.goodreturns.in/petrol-price-in-[city].html
async function getFuelPrices(city) {
    if (!city) return { petrol: { available: false }, diesel: { available: false } };

    const formattedCity = city.toLowerCase().replace(/[^a-z]/g, '-');
    try {
        // We try to scrape Petrol
        const petrolUrl = `https://www.goodreturns.in/petrol-price-in-${formattedCity}.html`;
        const pResponse = await axios.get(petrolUrl, { timeout: 5000 });
        const p$ = cheerio.load(pResponse.data);
        // Usually the main price is inside a specific element, we'll try to find a strong tag with ₹
        const pText = p$('.text-center .price').text() || p$('strong:contains("₹")').first().text();
        const petrolPrice = pText.match(/₹?(?:\s)?([\d,]+\.?\d*)/);

        // Diesel
        const dieselUrl = `https://www.goodreturns.in/diesel-price-in-${formattedCity}.html`;
        const dResponse = await axios.get(dieselUrl, { timeout: 5000 });
        const d$ = cheerio.load(dResponse.data);
        const dText = d$('.text-center .price').text() || d$('strong:contains("₹")').first().text();
        const dieselPrice = dText.match(/₹?(?:\s)?([\d,]+\.?\d*)/);

        return {
            petrol: {
                available: !!petrolPrice,
                price: petrolPrice ? `₹${petrolPrice[1]}` : null
            },
            diesel: {
                available: !!dieselPrice,
                price: dieselPrice ? `₹${dieselPrice[1]}` : null
            }
        };
    } catch (error) {
        // If 404 or any other error, fallback to unavailable
        return { petrol: { available: false }, diesel: { available: false } };
    }
}

// Fetch Google Demand Trends
// Since google trends API returns data points relative over time, we check the slope of recent points
async function getDemandTrend(keyword) {
    try {
        const res = await googleTrends.interestOverTime({ keyword: keyword, startTime: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)) });
        const parsed = JSON.parse(res);
        const timelineData = parsed.default.timelineData;

        if (timelineData && timelineData.length > 1) {
            const recent = timelineData[timelineData.length - 1].value[0];
            const previous = timelineData[timelineData.length - 2].value[0];

            let status = 'Normal';
            if (recent > previous * 1.5) status = 'High Demand';
            else if (recent < previous * 0.5) status = 'Low Demand';

            return { available: true, status };
        }
    } catch (error) {
        console.error(`Error fetching trend for ${keyword}`, error.message);
    }
    return { available: false };
}

module.exports = {
    checkServiceStatus,
    getFuelPrices,
    getDemandTrend
};
