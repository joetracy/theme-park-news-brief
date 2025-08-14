const { google } = require('googleapis');

async function sendEmail(briefData) {
  try {
    const auth = await authorize();
    const gmail = google.gmail({ version: 'v1', auth });
    
    const htmlContent = generateEmailHTML(briefData);
    const rawEmail = createRawEmail(htmlContent);
    
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawEmail,
      },
    });
    
    console.log('Email sent successfully:', result.data.id);
    return result.data;
    
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

async function authorize() {
  const credentials = {
    installed: {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback']
    }
  };
  
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  
  const token = {
    access_token: process.env.GOOGLE_ACCESS_TOKEN,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    token_type: 'Bearer'
  };
  
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

function generateEmailHTML(briefData) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        h1 { color: #3081c3; border-bottom: 2px solid #3081c3; padding-bottom: 10px; }
        h2 { color: #3081c3; margin-top: 30px; font-weight: bold; }
        .developing { background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; }
        .glance { background-color: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 5px; border-left: 4px solid #3ec0c2; }
        .story { margin: 15px 0; }
        .story-number { font-weight: bold; color: #3081c3; }
        .story-title { font-weight: bold; color: #333; }
        .story-content { margin-top: 5px; }
        .source-info { margin-top: 8px; font-size: 14px; color: #666; }
        .source-link { color: #3081c3; text-decoration: none; }
        .source-link:hover { text-decoration: underline; }
        ul { padding-left: 20px; }
        li { margin: 10px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <h1>Theme Park News Brief for ${dateStr}</h1>
    
    ${briefData.alerts.length > 0 ? `
    <div class="developing">
        <strong>Developing:</strong> ${briefData.alerts[0].summary} 
        <div class="source-info">Source: ${briefData.alerts[0].source} / <a href="${briefData.alerts[0].url}" class="source-link">LINK</a></div>
    </div>
    ` : ''}
    
    <h2>Today at a Glance</h2>
    <div class="glance">
        ${briefData.summary}
    </div>
    
    <h2>Top Stories</h2>
    ${briefData.topStories.map((story, index) => `
    <div class="story">
        <div><span class="story-number">${index + 1}.</span> <span class="story-title">${story.title}</span></div>
        <div class="story-content">${story.summary}</div>
        <div class="source-info">Source: ${story.source} / <a href="${story.url}" class="source-link">LINK</a></div>
    </div>
    `).join('')}
    
    ${briefData.alsoNoted.length > 0 ? `
    <h2>Also Noted</h2>
    <ul>
        ${briefData.alsoNoted.map(item => `
        <li>${item.summary}
        <div class="source-info">Source: ${item.source} / <a href="${item.url}" class="source-link">LINK</a></div>
        </li>
        `).join('')}
    </ul>
    ` : ''}
    
    <h2>What's Next</h2>
    <ul>
        <li>Check back tomorrow for the latest theme park and themed experience news.</li>
    </ul>
    
    <div class="footer">
        Part of the Theme Park Magazine network — <a href="https://themeparkmagazine.com" class="source-link">Theme Park Magazine</a>
    </div>
</body>
</html>`;
}

function createRawEmail(htmlContent) {
  const email = [
    'Content-Type: text/html; charset="UTF-8"',
    'MIME-Version: 1.0',
    `To: joetracy@earthlink.net`,
    `From: jtracy@themeparkmagazine.com`,
    `Subject: Theme Park News Brief for ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    '',
    htmlContent
  ].join('\n');
  
  return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = { sendEmail };
