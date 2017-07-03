package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/ChimeraCoder/anaconda"
	"github.com/PuerkitoBio/goquery"
	"io/ioutil"
	"net/url"
	"strings"
	"unicode/utf8"
)

type Config struct {
	ConsumerKey       string `json:"consumerKey"`
	ConsumerSecret    string `json:"consumerSecret"`
	AccessToken       string `json:"accessToken"`
	AccessTokenSecret string `json:"accessTokenSecret"`
	PageUrl           string `json:"pageUrl"`
	InfoTextSelector  string `json:"infoTextSelector"`
	TweetTemplate     string `json:"tweetTemplate"`
}

func main() {
	// "go run main.go -c config_file_name.json" みたいな感じで起動する
	configPath := flag.String("c", "config.json", "Config file path")
	flag.Parse()
	config := LoadConfig(*configPath)

	anaconda.SetConsumerKey(config.ConsumerKey)
	anaconda.SetConsumerSecret(config.ConsumerSecret)
	api := anaconda.NewTwitterApi(config.AccessToken, config.AccessTokenSecret)

	var prevInfoText, currentInfoText string

	// 最初のスクレイピング。初期状態として保持しておく
	prevInfoText = GetInfoText(config.PageUrl, config.InfoTextSelector)

	for {
		// スクレイピング
		currentInfoText = GetInfoText(config.PageUrl, config.InfoTextSelector)

		// 差分があったら Tweet
		if prevInfoText != currentInfoText {
			generated := GenerateTweetText(config.TweetTemplate, currentInfoText, config.PageUrl)
			fmt.Println("Post Tweet : " + generated)
			v := url.Values{}
			_, err := api.PostTweet(generated, v)
			if err != nil {
				fmt.Println(err)
			}
		}

		prevInfoText = currentInfoText
	}
}

func LoadConfig(filePath string) Config {
	var config Config
	data, _ := ioutil.ReadFile(filePath)
	json.Unmarshal(data, &config)
	return config
}

func GetInfoText(url string, selector string) string {
	fmt.Println("HTTP GET : " + url)
	doc, err := goquery.NewDocument(url)
	if err != nil {
		fmt.Println(err)
	}
	infoText := doc.Find(selector).Text()
	fmt.Println("Info Text : " + infoText)
	return infoText
}

func GenerateTweetText(template, infoText, pageUrl string) string {
	var generated string
	// 両端の whitespace を削り取る
	infoText = strings.TrimSpace(infoText)

	generated = strings.Replace(template, "{infoText}", infoText, -1)
	generated = strings.Replace(generated, "{pageUrl}", pageUrl, -1)

	// Twitter の最大投稿可能文字数を超えてたら、infoText の末尾から超過分を削る
	if utf8.RuneCountInString(generated) > 140 {
		fmt.Println("文字列が長過ぎるので削ります")

		// 削らなきゃいけない文字数
		number := utf8.RuneCountInString(generated) - 140
		shorted := []rune(infoText)
		shorted = shorted[0 : len(shorted)-number]

		// 末尾に省略済を示す記号を追加する
		// U+22ef - Midline horizontal ellipsis (⋯)
		shorted[len(shorted)-1] = rune(0x22ef)

		generated = strings.Replace(template, "{infoText}", string(shorted), -1)
		generated = strings.Replace(generated, "{pageUrl}", pageUrl, -1)
	}

	return generated
}
