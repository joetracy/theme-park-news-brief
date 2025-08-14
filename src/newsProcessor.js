const axios = require('axios');
const Parser = require('rss-parser');
const NodeCache = require('node-cache');
const stringSimilarity = require('string-similarity');

const parser = new Parser();
const cache = new NodeCache({ stdTTL: 259200 }); // 72 hours

const NEWS_SOURCES = {
  rssFeeds: [
    // Official Park Blogs
    'https://disneyparks.disney.go.com/blog/feed/',
    'https://blog.universalstudios.com/feed/',
    'https://seaworldparks.com/en/feed',
    'https://www.cedarfair.com/news/feed',
    'https://www.sixflags.com/news/feed',
    
    // Major News Outlets
    'https://news.google.com/rss/search?q=theme+park&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=themed+experience&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Disney+park&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Universal+Studios&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=LEGOLAND&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Six+Flags&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Cedar+Fair&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=SeaWorld&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=roller+coaster&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=dark+ride&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Knott%27s+Berry+Farm&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Dollywood&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Busch+Gardens&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=teamLab&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=immersive+experience&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Meow+Wolf&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=AREA15&hl=en-US&gl=US&ceid=US:en',
    
    // News Aggregators
    'https://news.yahoo.com/rss/entertainment',
    'https://feeds.aol.com/aol/us/',
    
    // Trade Publications
    'https://www.themeparkmagazine.com/feed/',
    
    // Press Release Services
    'https://www.prnewswire.com/rss/consumer-products-retail-latest-news/consumer-products-retail-latest-news-list.rss',
    'https://www.businesswire.com/rss/home/20121106006159/en/',
    
    // Regional News (Theme Park Heavy Areas)
    'https://www.orlandosentinel.com/news/tourism/feed/',
    'https://www.ocregister.com/feed/'
  ],
  
  searchTerms: [
    // Core Terms
    'theme park', 'themed experience', 'amusement park', 'water park',
    'dark ride', 'roller coaster', 'thrill ride', 'family ride',
    'attraction', 'themed attraction', 'interactive attraction',
    
    // Major Companies
    'Disney', 'Universal', 'SeaWorld', 'Six Flags', 'Cedar Fair', 'Merlin',
    'LEGOLAND', 'Knott\'s Berry Farm', 'Dollywood', 'Busch Gardens',
    'Hersheypark', 'Silver Dollar City', 'Parques Reunidos',
    
    // Themed Experiences
    'teamLab', 'immersive experience', 'Van Gogh experience', 
    'Harry Potter experience', 'Meow Wolf', 'AREA15', 'escape room',
    'interactive experience', 'digital art', 'projection mapping',
    
    // Technical Terms
    'animatronic', 'trackless ride', 'LSM launch', 'coaster',
    'virtual reality', 'augmented reality', 'motion simulator',
    
    // Industry Terms
    'IAAPA', 'themed entertainment', 'attraction industry',
    'park operations', 'guest experience', 'queue system'
  ],
  
  blockedDomains: [
    'insidethemagic.net',
    'disneyfanatic.com'
  ]
};

async function generateDailyBrief() {
  console.log('Starting enhanced news discovery...');
  
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
    
    // More generous selection
    const topStories = sorted.slice(0, 8);
    const alsoNoted = sorted.slice(8, 12);
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
  
  // Process RSS feeds with more generous limits
  for (const feedUrl of NEWS_SOURCES.rssFeeds) {
    try {
      console.log(`Processing RSS feed: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);
      
      for (const item of feed.items.slice(0, 15)) { // Increased from 10 to 15
        if (isRecentArticle(item.pubDate)) {
          const article = parseRSSItem(item, feedUrl);
          if (isThemeParkRelated(article)) {
            articles.push(article);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing RSS feed ${feedUrl}:`, error.message);
    }
  }
  
  console.log(`Total articles discovered: ${articles.length}`);
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

function isRecentArticle(pubDate) {
  if (!pubDate) return true; // Include if no date (better safe than sorry)
  const articleDate = new Date(pubDate);
  const hoursAgo = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);
  return hoursAgo <= 36; // Expanded from 24 to 36 hours
}

function isThemeParkRelated(article) {
  const text = (article.title + ' ' + article.summary).toLowerCase();
  const keywords = [
    'theme park', 'amusement park', 'disney', 'universal', 'roller coaster', 
    'attraction', 'themed experience', 'seaworld', 'six flags', 'cedar fair',
    'legoland', 'knott', 'dollywood', 'busch gardens', 'dark ride',
    'teamlab', 'immersive', 'meow wolf', 'area15', 'animatronic',
    'coaster', 'ride', 'park', 'entertainment', 'experience'
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
    
    // Check for paywall indicators (less aggressive)
    if (hasPaywall(article)) {
      continue;
    }
    
    // Check URL deduplication
    const canonicalUrl = canonicalizeUrl(article.url);
    if (seenUrls.has(canonicalUrl)) {
      continue;
    }
    
    // Check title similarity (less aggressive - was 0.8, now 0.9)
    const similarTitle = seenTitles.find(title => 
      stringSimilarity.compareTwoStrings(title, article.title) > 0.9
    );
    if (similarTitle) {
      continue;
    }
    
    // Cache check (72-hour rolling)
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

function hasPaywall(article) {
  const indicators = [
    'subscribe to read', 'premium content', 'member exclusive',
    'subscription required', 'sign up to continue', 'register to read'
  ];
  const text = (article.title + ' ' + article.summary).toLowerCase();
  return indicators.some(indicator => text.includes(indicator));
}

function canonicalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove UTM parameters and fragments
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
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Create a comprehensive "Today at a Glance" summary for these theme park news stories. Write at a 6th grade reading level, use professional journalistic language (avoid promotional words), and create 3-4 well-developed paragraphs that flow smoothly and provide good context.

Stories:
${topStories.map(story => `• ${story.title}: ${story.summary}`).join('\n')}

Write a cohesive, informative summary that connects these stories naturally and gives readers a complete picture of today's theme park industry developments.`
          }
        ]
      })
    });
    
    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Error generating summary:', error);
    // Better fallback summary
    return `Today's theme park industry saw ${topStories.length} significant developments across major operators and attractions. ${topStories.slice(0, 3).map(story => story.summary).join(' ')} These updates reflect ongoing trends in theme park operations, guest experience enhancements, and industry innovation.`;
  }
}

function cleanTitle(title) {
  return title.replace(/\s+/g, ' ').replace(/\[.*?\]/g, '').trim();
}

function cleanSummary(summary) {
  if (!summary) return 'No summary available.';
  return summary.replace(/\s+/g, ' ').replace(/<[^>]*>/g, '').trim().substring(0, 300);
}

function extractSource(item, fallback) {
  if (item.creator) return item.creator;
  if (item.author) return item.author;
  if (fallback.includes('google.com')) return 'Google News';
  if (fallback.includes('yahoo.com')) return 'Yahoo News';
  if (fallback.includes('aol.com')) return 'AOL News';
  if (fallback.includes('prnewswire.com')) return 'PR Newswire';
  if (fallback.includes('businesswire.com')) return 'Business Wire';
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
  return Buffer.from(text).toString('base64').substring(0, 16);
}

module.exports = { generateDailyBrief };
