import { region, config } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { firestore } from 'firebase-admin';
import { TwitterApi } from 'twitter-api-v2';

const { JSDOM } = require('jsdom');
const twitterText = require('twitter-text');

initializeApp();
const db = firestore();

const pageUrl = config().parser.pageurl;

exports.scheduledFunctionCrontab = region('asia-northeast1')
  .runWith({ secrets: ["SECRETS"] })
  .pubsub
  .schedule('* * * * *')
  .onRun(async () => {
    if(!process.env.SECRETS) {
      console.error("SECRETS が定義されていません");
      return;
    }

    const [accessToken, accessSecret, appKey, appSecret] = process.env.SECRETS.split("\n");

    const twitterClient = new TwitterApi({
      appKey: appKey,
      appSecret: appSecret,
      accessToken: accessToken,
      accessSecret: accessSecret
    });

    const dom = await JSDOM.fromURL(pageUrl);

    const emergencyInfoText = dom.window.document.querySelector(config().parser.infotextselector)
      .textContent.trim();

    const snapshot = await db.collection('emergencyInfoText').doc('latest').get()

    const latestText = snapshot.data()?.text;

    // DB に保存された前回分のテキストと差分がない
    if (latestText === emergencyInfoText) {
      console.log("監視結果: 差分はありません。");
    }

    // DB に保存された前回分のテキストと差分がある
    else {
      // Tweet できる文字数まで切り詰める
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

      const { data: createdTweet } = await twitterClient.v2.tweet(validTweetText);

      console.log(`監視結果: 差分が検出されたため、ツイートしました。\n${createdTweet.id}, ${createdTweet.text}`);

      try {
        await db.collection('emergencyInfoText').doc('latest').set({ text: emergencyInfoText });
        console.log("監視結果: ツイートが完了したため、データベースに書き込みました。");
      } catch {
        console.error("エラー: データベースへの書き込みに失敗しました。");
      }
    }

    return 0;
  });
