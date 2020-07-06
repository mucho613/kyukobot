import { pubsub, config } from 'firebase-functions';
import { initializeApp, firestore } from 'firebase-admin';

const { JSDOM } = require('jsdom');
const Twitter = require('twitter');
const twitterText = require('twitter-text')

initializeApp();
const db = firestore();

const pageUrl = config().parser.pageurl;
const client = new Twitter({
  consumer_key: config().twitter.consumerkey,
  consumer_secret: config().twitter.consumersecret,
  access_token_key: config().twitter.accesstokenkey,
  access_token_secret: config().twitter.accesstokensecret
});

exports.scheduledFunctionCrontab = pubsub.schedule('* * * * *').onRun((context) => {
  JSDOM.fromURL(pageUrl).then((dom: any) => {
    const emergencyInfoText = dom.window.document.querySelector(config().parser.infotextselector)
      .textContent.trim();

    db.collection('emergencyInfoText').doc('latest').get().then(snapshot => {
      const latestText = snapshot.data()?.text;
      // 前回と差分がある
      if (latestText !== emergencyInfoText) {
        const validTweetText = (() => {
          let trimCount = 0;
          let trimmedText = '';
          let trimmed = false;
          while (true) {
            trimmedText = emergencyInfoText.substring(0, emergencyInfoText.length - trimCount);
            if (trimmed) trimmedText += '…';
            const text = `${trimmedText} ${pageUrl}`;
            if (twitterText.parseTweet(text).valid) return text;
            trimCount++;
            trimmed = true;
          }
        })();
        client.post('statuses/update', { status: validTweetText }, (error: any, tweet: any) => {
          if (!error) console.log(`監視結果: 差分が検出されたため、ツイートしました。\n${validTweetText}`);
          db.collection('emergencyInfoText').doc('latest').set({ text: emergencyInfoText })
            .then(() => console.log("監視結果: ツイートが完了したため、データベースに書き込みました。"))
            .catch(() => console.error("エラー: データベースへの書き込みに失敗しました。"));
        });
      }
      // 差分がない
      else console.log("監視結果: 差分はありません。");
      return 0;
    }).catch(() => {
      console.error("エラー: データベースからの読み込みに失敗しました。")
      return 0;
    });
  });
});
