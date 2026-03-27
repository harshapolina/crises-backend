require('dotenv').config();
const axios = require('axios');

const NEWS_API_KEY = process.env.NEWS_API_KEY || '4683674f90914d2c93406e6d4327c197';
const NEWS_API_URL = 'https://newsapi.org/v2/everything';

// In-memory store for latest news (until DB is connected)
let latestNews = [];

/**
 * Fetch war-related news updates.
 */
async function fetchNewsUpdates() {
  try {
    console.log(`[${new Date().toISOString()}] Fetching latest war-related news...`);
    const response = await axios.get(NEWS_API_URL, {
      params: {
        q: 'war OR "supply chain" OR fuel OR crisis',
        language: 'en',
        sortBy: 'publishedAt',
        apiKey: NEWS_API_KEY,
        pageSize: 10, // Keep it small and quick
      }
    });

    if (response.data && response.data.articles) {
      latestNews = response.data.articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source.name,
        url: article.url,
        publishedAt: article.publishedAt
      }));
      console.log(`[${new Date().toISOString()}] Successfully fetched ${latestNews.length} news articles.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching news:`, error.message);
    if (error.response && error.response.data) {
       console.error('API Response:', error.response.data);
    }
  }
}

/**
 * Start the news fetching interval
 * @param {number} intervalSeconds - Seconds between updates
 */
function startNewsService(intervalSeconds = 30) {
  // Initial fetch
  fetchNewsUpdates();
  
  // Refresh by secs
  setInterval(fetchNewsUpdates, intervalSeconds * 1000);
  console.log(`News service started. Refreshing every ${intervalSeconds} seconds.`);
}

/**
 * Get the latest news
 */
function getLatestNews() {
  return latestNews;
}

module.exports = {
  fetchNewsUpdates,
  startNewsService,
  getLatestNews
};

// If run directly for testing
if (require.main === module) {
  startNewsService(15); // Test with 15 sec interval
}
