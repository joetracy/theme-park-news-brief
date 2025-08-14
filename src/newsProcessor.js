const axios = require('axios');
const Parser = require('rss-parser');
const NodeCache = require('node-cache');
const stringSimilarity = require('string-similarity');

const parser = new Parser();
const cache = new NodeCache({ stdTTL: 259200 }); // 72 hours

const NEWS_SOURCES = {
  rssFeeds: [
    'https://disneyparks.disney.go.com/blog/feed/',
    'https://news.google.com/rss/search?q=theme+park&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=themed+experience&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Disney+park&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Universal+Studios&hl=en-US&gl=US&ceid=US:en'
  ],
  
  blockedDomains: [
    'insidethemagic.net',
    'disneyfanatic.com'
  ]
};

async function generateDailyBrief() {
  console.log('Starting news discovery...');
  
  try {
    const articles = await discoverArticles();
    console.log(`Discovered ${articles.length} potential articles`);
    
    const filtered = await filterAndDeduplicate(articles);
    console.log(`Filtered to ${filtered.length} unique articles`);
    
    const sorted = filtered.sort((a, b) => {
      const significanceOrder = { critical: 3, high: 2, medium: 1, low: 0 };
      const sigDiff = significanceOrder[b.significance] - significanceOrder[a.significance];
      if (sigDiff !== 0) return sigDiff;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    
    const topStories = sorted.slice(0, 6);
    const alsoNoted = sorted.slice(6, 9);
    const alerts = sorted.filter(article => article.isAlert);
    
    const summary = await generateSummary(topStories);
    
    return {
      topStories,
      alsoNoted,
      alerts,
      summary,
      generatedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error generating daily brief:', error);
    throw error;
  }
}

async function discoverArticles() {
  const articles = [];
  
  for (const feedUrl of NEWS_SOURCES.rssFeeds) {
    try {
      console.log(`Processing RSS feed: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      
      for (const item of feed.items.slice(0, 10)) {
        if (isRecentArticle(item.pubDate)) {
          articles.push(parseRSSItem(item, feedUrl));
        }
      }
    } catch (error) {
      console.error(`Error processing RSS feed ${feedUrl}:`, error.message);
    }
  }
  
  return articles;
}

function parseRSSItem(item, source) {
  return {
    id: generateId(item.link),
    title: cleanTitle(item.title),
    url: item.link,
    source: extractSource(item, source),
    publishedAt: item.pubDate,
    summary: cleanSummary(item.contentSnippet || item.content || ''),
    category: categorizeArticle(item.title, item.contentSnippet),
    significance: assessSignificance(item.title, item.contentSnippet),
    isAlert: isAlertWorthy(item.title, item.contentSnippet)
  };
}

function isRecentArticle(pubDate) {
  if (!pubDate) return false;
  const articleDate = new Date(pubDate);
  const hoursAgo = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);
  return hoursAgo <= 24;
}

async function filterAndDeduplicate(articles) {
  const filtered = [];
  const seenUrls = new Set();
  const seenTitles = [];
  
  for (const article of articles) {
    if (NEWS_SOURCES.blockedDomains.some(domain => article.url.includes(domain))) {
      continue;
    }
    
    const canonicalUrl = canonicalizeUrl(article.url);
    if (seenUrls.has(canonicalUrl)) {
      continue;
    }
    
    const similarTitle = seenTitles.find(title => 
      stringSimilarity.compareTwoStrings(title, article.title) > 0.8
    );
    if (similarTitle) {
      continue;
    }
    
    const cacheKey = `article_${generateId(canonicalUrl)}`;
    if (cache.has(cacheKey)) {
      continue;
    }
    
    seenUrls.add(canonicalUrl);
    seenTitles.push(article.title);
    cache.set(cacheKey, true);
    
    filtered.push(article);
  }
  
  return filtered;
}

function canonicalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    urlObj.search = '';
    urlObj.hash = '';
    return urlObj.toString();
  } catch {
    return url;
  }
}

async function generateSummary(topStories) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: `Create a "Today at a Glance" summary for these theme park news stories. Write at a 6th grade reading level, use professional journalistic language, and create 2-3 paragraphs that flow smoothly.

Stories:
${topStories.map(story => `• ${story.title}: ${story.summary}`).join('\n')}

Write a cohesive summary that connects these stories naturally.`
          }
        ]
      })
    });
    
    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Error generating summary:', error);
    return topStories.slice(0, 3).map(story => story.summary).join(' ');
  }
}

function cleanTitle(title) {
  return title.replace(/\s+/g, ' ').trim();
}

function cleanSummary(summary) {
  return summary.replace(/\s+/g, ' ').replace(/<[^>]*>/g, '').trim().substring(0, 200);
}

function extractSource(item, fallback) {
  return item.creator || item.author || fallback;
}

function categorizeArticle(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  
  if (text.includes('safety') || text.includes('injury') || text.includes('incident')) return 'Safety';
  if (text.includes('opening') || text.includes('announcement') || text.includes('new')) return 'Announcements';
  if (text.includes('construction') || text.includes('building')) return 'Construction';
  if (text.includes('financial') || text.includes('earnings') || text.includes('revenue')) return 'Financial';
  if (text.includes('festival') || text.includes('event')) return 'Events';
  
  return 'General';
}

function assessSignificance(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  
  if (text.includes('injury') || text.includes('evacuation') || text.includes('fire')) return 'critical';
  if (text.includes('disney') || text.includes('universal') || text.includes('new ride')) return 'high';
  if (text.includes('announcement') || text.includes('opening')) return 'medium';
  
  return 'low';
}

function isAlertWorthy(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  return text.includes('injury') || text.includes('evacuation') || text.includes('derail') || text.includes('fire');
}

function generateId(text) {
  return Buffer.from(text).toString('base64').substring(0, 16);
}

module.exports = { generateDailyBrief };
