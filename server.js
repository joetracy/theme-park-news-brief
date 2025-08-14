require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { generateDailyBrief } = require('./src/newsProcessor');
const { sendEmail } = require('./src/emailSender');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    nextRun: getNextRunTime() 
  });
});

// Manual trigger endpoint
app.post('/trigger-brief', async (req, res) => {
  try {
    console.log('Manual trigger initiated...');
    const briefData = await generateDailyBrief();
    const emailResult = await sendEmail(briefData);
    
    res.json({ 
      success: true, 
      message: 'Brief sent successfully',
      articles: briefData.topStories.length,
      emailId: emailResult.messageId
    });
  } catch (error) {
    console.error('Manual trigger failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Schedule daily brief at 8 AM Pacific Time (3 PM UTC)
cron.schedule('0 15 * * *', async () => {
  console.log('Starting scheduled daily brief generation...');
  try {
    const briefData = await generateDailyBrief();
    const emailResult = await sendEmail(briefData);
    console.log('Daily brief sent successfully:', emailResult.messageId);
  } catch (error) {
    console.error('Scheduled brief failed:', error);
  }
}, {
  scheduled: true,
  timezone: "America/Los_Angeles"
});

function getNextRunTime() {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(8, 0, 0, 0);
  
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  
  return nextRun.toISOString();
}

app.listen(PORT, () => {
  console.log(`Theme Park News Brief server running on port ${PORT}`);
  console.log(`Next scheduled run: ${getNextRunTime()}`);
});
