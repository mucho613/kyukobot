package main

import (
        "encoding/json"
        "fmt"
        "github.com/ChimeraCoder/anaconda"
        "github.com/PuerkitoBio/goquery"
        "io/ioutil"
        "net/url"
)

type Config struct {
        ConsumerKey       string `json:"consumerKey"`
        ConsumerSecret    string `json:"consumerSecret"`
        AccessToken       string `json:"accessToken"`
        AccessTokenSecret string `json:"accessTokenSecret"`
        PageUrl           string `json:"pageUrl"`
}

func main() {
	config := LoadConfig("config.json")
        anaconda.SetConsumerKey(config.ConsumerKey)
        anaconda.SetConsumerSecret(config.ConsumerSecret)
        api := anaconda.NewTwitterApi(config.AccessToken, config.AccessTokenSecret)

	var prevInfoText, currentInfoText string
	prevInfoText = GetInfoText(config.PageUrl)

	for {
		currentInfoText = GetInfoText(config.PageUrl)

		if prevInfoText != currentInfoText {
			fmt.Println("Post Tweet : " + currentInfoText)
			v := url.Values{}
			_, err := api.PostTweet(currentInfoText, v)
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

func GetInfoText(url string) string {
	fmt.Println("HTTP GET : " + url)
        doc, _ := goquery.NewDocument(url)
        return doc.Find("#emergency-info .news-content01").Text()
}
