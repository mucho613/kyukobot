package main

import (
	"encoding/json"
	"flag"
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
	InfoTextSelector  string `json:"infoTextSelector"`
}

func main() {
	configPath := flag.String("c", "config.json", "Config file path")
	flag.Parse()
	config := LoadConfig(*configPath)

	anaconda.SetConsumerKey(config.ConsumerKey)
	anaconda.SetConsumerSecret(config.ConsumerSecret)
	api := anaconda.NewTwitterApi(config.AccessToken, config.AccessTokenSecret)

	var prevInfoText, currentInfoText string
	prevInfoText = GetInfoText(config.PageUrl, config.InfoTextSelector)

	for {
		currentInfoText = GetInfoText(config.PageUrl, config.InfoTextSelector)

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

func GetInfoText(url string, selector string) string {
	fmt.Println("HTTP GET : " + url)
	doc, _ := goquery.NewDocument(url)
	infoText := doc.Find(selector).Text()
	fmt.Println("Info Text : " + infoText)
	return infoText
}
