const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const NodeCache = require('node-cache');
const stringSimilarity = require('string-similarity');

const parser = new Parser();
const cache = new NodeCache({ stdTTL: 259200 }); // 72 hours

const NEWS_SOURCES = {
  // Direct Google News search URLs (these will be scraped)
  googleNewsSearches: [
    'https://news.google.com/search?q=theme%20park&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=disney%20park&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=universal%20studios&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=six%20flags&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=cedar%20fair&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=seaworld&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=legoland&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=roller%20coaster&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=dark%20ride&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=themed%20experience&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=immersive%20experience&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=teamlab&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=meow%20wolf&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=dollywood&hl=en-US&gl=US&ceid=US%3Aen',
    'https://news.google.com/search?q=busch%20gardens&hl=en-US&gl=US&ceid=US%3Aen'
  ],
  
  // RSS feeds for official sources
  rssFeeds: [
    'https://disneyparks.disney.go.com/blog/feed/',
    'https://blog.universalstudios.com/feed/',
    'https://www.themeparkmagazine.com/feed/',
    'https://www.prnewswire.com/rss/consumer-products-retail-latest-news/consumer-products-retail-latest-news-list.rss'
  ],
  
  blockedDomains: [
    'insidethemagic.net',
    'disneyfanatic.com'
  ]
};

async function generateDailyBrief() {
  console.log('Starting comprehensive news discovery...');
  
  try {
    const articles = await discoverArticles();
    console.log(`Discovered ${articles.length} potential articles`);
    
    const filtered = await filterAndDeduplicate(articles);
    console.log(`Filtered to ${filtered.length} unique articles`);
    
    const sorted = filtered.sort((a, b) => {
      const significanceOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const sigDiff = significanceOrder[b.significance] - significanceOrder[a.significance];
      if (sigDiff !== 0) return sigDiff;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
    
    const topStories = sorted.slice(0, 10);
    const alsoNoted = sorted.slice(10, 15);
    const alerts = sorted.filter(article => article.isAlert);
    
    const summary = await generateSummary(topStories);
    
    console.log(`Final selection: ${topStories.length} top stories, ${alsoNoted.length} also noted`);
    
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
  
  // Scrape Google News search results directly
  console.log('Scraping Google News search results...');
  for (const searchUrl of NEWS_SOURCES.googleNewsSearches) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
      const googleArticles = await scrapeGoogleNews(searchUrl);
      articles.push(...googleArticles);
      console.log(`Found ${googleArticles.length} articles from Google News search`);
    } catch (error) {
      console.error(`Error scraping Google News search:`, error.message);
    }
  }
  
  // Process RSS feeds for official sources
  console.log('Processing official RSS feeds...');
  for (const feedUrl of NEWS_SOURCES.rssFeeds) {
    try {
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
  
  console.log(`Total articles discovered: ${articles.length}`);
  return articles;
}

async function scrapeGoogleNews(searchUrl) {
  const articles = [];
  
  try {
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    
    // Google News uses specific selectors for articles
    $('article').each((i, element) => {
      try {
        const $article = $(element);
        const $titleLink = $article.find('a[href*="/articles/"]').first();
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href');
        
        if (title && href && title.length > 10) {
          // Extract source and time
          const source = $article.find('div[data-n-tid]').first().text().trim() || 'Google News';
          const timeText = $article.find('time').attr('datetime') || new Date().toISOString();
          
          const article = {
            id: generateId(href),
            title: cleanTitle(title),
            url: href.startsWith('http') ? href : `https://news.google.com${href}`,
            source: cleanSource(source),
            publishedAt: timeText,
            summary: generateSummaryFromTitle(title),
            category: categorizeArticle(title, ''),
            significance: assessSignificance(title, ''),
            isAlert: isAlertWorthy(title, '')
          };
          
          if (isThemeParkRelated(article) && isRecentArticle(article.publishedAt)) {
            articles.push(article);
          }
        }
      } catch (err) {
        // Skip malformed articles
      }
    });
    
    // Alternative selector for different Google News layouts
    if (articles.length === 0) {
      $('h3, h4').each((i, element) => {
        try {
          const $headline = $(element);
          const $link = $headline.find('a').first();
          const title = $link.text().trim() || $headline.text().trim();
          const href = $link.attr('href');
          
          if (title && title.length > 10) {
            const article = {
              id: generateId(title + Date.now()),
              title: cleanTitle(title),
              url: href && href.startsWith('http') ? href : `https://news.google.com/search?q=${encodeURIComponent(title)}`,
              source: 'Google News',
              publishedAt: new Date().toISOString(),
              summary: generateSummaryFromTitle(title),
              category: categorizeArticle(title, ''),
              significance: assessSignificance(title, ''),
              isAlert: isAlertWorthy(title, '')
            };
            
            if (isThemeParkRelated(article)) {
              articles.push(article);
            }
          }
        } catch (err) {
          // Skip malformed articles
        }
      });
    }
    
  } catch (error) {
    console.error('Error scraping Google News:', error.message);
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
    summary: cleanSummary(item.contentSnippet || item.content || item.title),
    category: categorizeArticle(item.title, item.contentSnippet),
    significance: assessSignificance(item.title, item.contentSnippet),
    isAlert: isAlertWorthy(item.title, item.contentSnippet)
  };
}

function generateSummaryFromTitle(title) {
  // Create a basic summary from the title for Google News articles
  if (title.length < 50) {
    return title + '.';
  }
  
  const words = title.split(' ');
  if (words.length > 15) {
    return words.slice(0, 15).join(' ') + '...';
  }
  
  return title;
}

function isRecentArticle(pubDate) {
  if (!pubDate) return true;
  const articleDate = new Date(pubDate);
  const hoursAgo = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);
  return hoursAgo <= 48; // 48 hour window
}

function isThemeParkRelated(article) {
  const text = (article.title + ' ' + article.summary).toLowerCase();
  const keywords = [
    'theme park', 'amusement park', 'disney', 'universal', 'roller coaster', 
    'attraction', 'themed experience', 'seaworld', 'six flags', 'cedar fair',
    'legoland', 'knott', 'dollywood', 'busch gardens', 'dark ride',
    'teamlab', 'immersive', 'meow wolf', 'area15', 'animatronic',
    'coaster', 'ride', 'park', 'entertainment', 'experience', 'hersheypark',
    'silver dollar city', 'knotts', 'magic kingdom', 'epcot', 'animal kingdom',
    'hollywood studios', 'disneyland', 'california adventure'
  ];
  return keywords.some(keyword => text.includes(keyword));
}

async function filterAndDeduplicate(articles) {
  const filtered = [];
  const seenUrls = new Set();
  const seenTitles = [];
  
  for (const article of articles) {
    // Check if blocked domain
    if (NEWS_SOURCES.blockedDomains.some(domain => article.url.includes(domain))) {
      continue;
    }
    
    // Check URL deduplication
    const canonicalUrl = canonicalizeUrl(article.url);
    if (seenUrls.has(canonicalUrl)) {
      continue;
    }
    
    // Check title similarity (less aggressive)
    const similarTitle = seenTitles.find(title => 
      stringSimilarity.compareTwoStrings(title, article.title) > 0.85
    );
    if (similarTitle) {
      continue;
    }
    
    // Cache check
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
  if (topStories.length === 0) {
    return "No significant theme park news was discovered in the last 24 hours. Check back tomorrow for the latest updates.";
  }
  
  try {
    // Simplified summary generation
    const storyTitles = topStories.slice(0, 5).map(story => story.title).join('. ');
    
    const prompt = `Write a professional 3-paragraph "Today at a Glance" summary for these theme park news stories. Use 6th grade reading level and journalistic tone: ${storyTitles}`;
    
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
            content: prompt
          }
        ]
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.content[0].text;
    } else {
      throw new Error('API response not ok');
    }
  } catch (error) {
    console.error('Error generating summary:', error);
    // Fallback summary
    const topTitles = topStories.slice(0, 3).map(story => story.title).join('. ');
    return `Today's theme park industry developments include several notable announcements and updates. ${topTitles}. These stories reflect ongoing trends in theme park operations, guest experiences, and industry innovation. More details are available in the full stories below.`;
  }
}

function cleanTitle(title) {
  return title.replace(/\s+/g, ' ').replace(/\[.*?\]/g, '').replace(/\|.*$/, '').trim();
}

function cleanSummary(summary) {
  if (!summary) return 'No summary available.';
  return summary.replace(/\s+/g, ' ').replace(/<[^>]*>/g, '').trim().substring(0, 250);
}

function cleanSource(source) {
  if (!source) return 'News Source';
  
  // Clean up common source formats
  source = source.replace(/\s*-.*$/, ''); // Remove everything after dash
  source = source.replace(/\.com.*$/, '.com'); // Clean domain suffixes
  source = source.trim();
  
  if (source.length === 0) return 'News Source';
  return source;
}

function extractSource(item, fallback) {
  if (item.creator) return item.creator;
  if (item.author) return item.author;
  if (fallback.includes('disneyparks')) return 'Disney Parks Blog';
  if (fallback.includes('universalstudios')) return 'Universal Studios Blog';
  if (fallback.includes('themeparkmagazine')) return 'Theme Park Magazine';
  if (fallback.includes('prnewswire')) return 'PR Newswire';
  return 'News Source';
}

function categorizeArticle(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  
  if (text.includes('safety') || text.includes('injury') || text.includes('incident') || text.includes('evacuation')) return 'Safety';
  if (text.includes('opening') || text.includes('announcement') || text.includes('new') || text.includes('launch')) return 'Announcements';
  if (text.includes('construction') || text.includes('building') || text.includes('expansion')) return 'Construction';
  if (text.includes('financial') || text.includes('earnings') || text.includes('revenue') || text.includes('stock')) return 'Financial';
  if (text.includes('festival') || text.includes('event') || text.includes('celebration')) return 'Events';
  if (text.includes('technology') || text.includes('digital') || text.includes('virtual') || text.includes('ai')) return 'Technology';
  
  return 'General';
}

function assessSignificance(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  
  // Critical
  if (text.includes('injury') || text.includes('death') || text.includes('evacuation') || 
      text.includes('fire') || text.includes('derail') || text.includes('accident')) return 'critical';
  
  // High
  if (text.includes('disney') || text.includes('universal') || text.includes('new ride') ||
      text.includes('grand opening') || text.includes('acquisition') || text.includes('closure')) return 'high';
  
  // Medium  
  if (text.includes('announcement') || text.includes('opening') || text.includes('expansion') ||
      text.includes('construction') || text.includes('technology') || text.includes('partnership')) return 'medium';
  
  return 'low';
}

function isAlertWorthy(title, content) {
  const text = (title + ' ' + content).toLowerCase();
  return text.includes('injury') || text.includes('death') || text.includes('evacuation') || 
         text.includes('derail') || text.includes('fire') || text.includes('emergency');
}

function generateId(text) {
  return Buffer.from(text + Date.now()).toString('base64').substring(0, 16);
}

module.exports = { generateDailyBrief };
