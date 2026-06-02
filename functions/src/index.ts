import { region, config } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { firestore } from 'firebase-admin';
import { TwitterApi } from 'twitter-api-v2';

const { JSDOM } = require('jsdom');
const twitterText = require('twitter-text');

initializeApp();
const db = firestore();

const pageUrl = config().parser.pageurl;
const discordDescriptionLimit = 3900;
const pageErrorNotificationIntervalMs = 30 * 60 * 1000;
const emergencyInfoCollection = db.collection('emergencyInfoText');
const latestEmergencyInfoDoc = emergencyInfoCollection.doc('latest');

const truncateForDiscord = (text: string): string => {
  if (text.length <= discordDescriptionLimit) return text;
  return `${text.substring(0, discordDescriptionLimit - 1)}…`;
};

const notifyDiscord = async (
  title: string,
  description: string,
  color: number
): Promise<boolean> => {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL が定義されていないため、Discord 通知をスキップしました。");
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title,
            description: truncateForDiscord(description),
            color,
            timestamp: new Date().toISOString()
          }
        ]
      })
    });

    if (!response.ok) {
      console.error(`Discord 通知に失敗しました: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Discord 通知中にエラーが発生しました。", error);
    return false;
  }
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
};

const getEmergencyInfoText = async (): Promise<string> => {
  const dom = await JSDOM.fromURL(pageUrl);
  const element = dom.window.document.querySelector(config().parser.infotextselector);

  if (!element?.textContent) {
    throw new Error("緊急連絡欄の要素またはテキストが見つかりませんでした。");
  }

  return element.textContent.trim();
};

const notifyPageErrorIfNeeded = async (error: unknown): Promise<void> => {
  const now = Date.now();

  try {
    const snapshot = await latestEmergencyInfoDoc.get();
    const lastNotifiedAt = snapshot.data()?.pageErrorLastNotifiedAtMillis;

    if (typeof lastNotifiedAt === "number" &&
      now - lastNotifiedAt < pageErrorNotificationIntervalMs) {
      console.log("ページ取得/HTML パースエラーの Discord 通知を抑制しました。");
      return;
    }
  } catch (stateError) {
    console.error("ページ取得/HTML パースエラーの通知状態取得に失敗しました。", stateError);
  }

  const notified = await notifyDiscord(
    "Kyukobot エラー",
    `ページ取得または HTML パースに失敗しました。\n\n${formatError(error)}`,
    0xff5555
  );

  if (notified) {
    try {
      await latestEmergencyInfoDoc.set({
        pageErrorLastNotifiedAtMillis: now
      }, { merge: true });
    } catch (stateError) {
      console.error("ページ取得/HTML パースエラーの通知状態保存に失敗しました。", stateError);
    }
  }
};

const resetPageErrorNotificationIfNeeded = async (
  latestData: FirebaseFirestore.DocumentData | undefined
): Promise<void> => {
  const lastNotifiedAt = latestData?.pageErrorLastNotifiedAtMillis;

  if (typeof lastNotifiedAt === "number" && lastNotifiedAt > 0) {
    try {
      await latestEmergencyInfoDoc.set({
        pageErrorLastNotifiedAtMillis: 0
      }, { merge: true });
    } catch (error) {
      console.error("ページ取得/HTML パースエラーの通知状態リセットに失敗しました。", error);
    }
  }
};

exports.scheduledFunctionCrontab = region('asia-northeast1')
  .runWith({ secrets: ["SECRETS", "DISCORD_WEBHOOK_URL"] })
  .pubsub
  .schedule('* * * * *')
  .onRun(async () => {
    if(!process.env.SECRETS) {
      console.error("SECRETS が定義されていません");
      await notifyDiscord(
        "Kyukobot エラー",
        "SECRETS が定義されていないため、X へ投稿できませんでした。",
        0xff5555
      );
      return;
    }

    const [accessToken, accessSecret, appKey, appSecret] = process.env.SECRETS.split("\n");

    const twitterClient = new TwitterApi({
      appKey: appKey,
      appSecret: appSecret,
      accessToken: accessToken,
      accessSecret: accessSecret
    });

    const emergencyInfoText = await (async (): Promise<string | undefined> => {
      try {
        return await getEmergencyInfoText();
      } catch (error) {
        console.error("エラー: ページ取得または HTML パースに失敗しました。", error);
        await notifyPageErrorIfNeeded(error);
        return undefined;
      }
    })();

    if (!emergencyInfoText) return 0;

    try {
      const snapshot = await latestEmergencyInfoDoc.get()
      const latestData = snapshot.data();
      const latestText = latestData?.text;

      await resetPageErrorNotificationIfNeeded(latestData);

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

        await notifyDiscord(
          "Kyukobot 投稿成功",
          `X への投稿が完了しました。\n\nPost ID: ${createdTweet.id}\n\n${createdTweet.text}`,
          0x55cc88
        );

        try {
          await latestEmergencyInfoDoc.set({
            text: emergencyInfoText,
            pageErrorLastNotifiedAtMillis: 0
          }, { merge: true });
          console.log("監視結果: ツイートが完了したため、データベースに書き込みました。");
        } catch (error) {
          console.error("エラー: データベースへの書き込みに失敗しました。", error);
          await notifyDiscord(
            "Kyukobot エラー",
            `X への投稿は成功しましたが、Firestore への書き込みに失敗しました。\n\nPost ID: ${createdTweet.id}\n\n${formatError(error)}`,
            0xffaa00
          );
        }
      }
    } catch (error) {
      console.error("エラー: 監視または X への投稿に失敗しました。", error);
      await notifyDiscord(
        "Kyukobot エラー",
        `監視または X への投稿に失敗しました。\n\n${formatError(error)}`,
        0xff5555
      );
    }

    return 0;
  });
