package main

import (
	"encoding/json"
	"fmt"
	"github.com/go-rod/rod/lib/proto"
)

func main() {
	var cookies []*proto.NetworkCookieParam
	j := `[{"domain": ".syosetu.org", "name": "ETURAN", "value": "404785_1", "sameSite": "lax"}]`
	err := json.Unmarshal([]byte(j), &cookies)
	fmt.Printf("Error: %v, Cookies: %+v\n", err, cookies[0])
}
