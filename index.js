const { JSDOM } = require('jsdom');

const admin = require('firebase-admin');
const functions = require('firebase-functions');

const Twitter = require('twitter');
const twitterText = require('twitter-text')

admin.initializeApp(functions.config().firebase);
let db = admin.firestore();

const pageUrl = process.env.PAGE_URL;
const client = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

exports.watch = () => {
  JSDOM.fromURL(pageUrl).then(dom => {
    const emergencyInfoText = dom.window.document.querySelector(process.env.INFO_TEXT_SELECTOR)
        .textContent.trim();

    db.collection('emergencyInfoText').doc('latest').get().then(shapshot => {
      const latestText = shapshot.data().text;
      // 前回と差分がある
      if(latestText !== emergencyInfoText) {
        console.log("差分あり");
        const validTweetText = (() => {
          let trimCount = 0;
          let trimmedText = '';
          let trimmed = false;
          while(true) {
            trimmedText = emergencyInfoText.substring(0, emergencyInfoText.length - trimCount);
            if(trimmed) trimmedText += '…';
            const text = `${trimmedText} ${pageUrl}`;
            if(twitterText.parseTweet(text).valid) return text;
            trimCount++;
            trimmed = true;
          }
        })();
        client.post('statuses/update', {status: validTweetText}, (error, tweet) => {
          if (!error) console.log(`ツイート！:\n${validTweetText}`);
        });
        db.collection('emergencyInfoText').doc('latest').set({
          text: emergencyInfoText
        });
      }
      // 差分がない
      else {
        console.log("差分なし");
      }
    });
  });
};
