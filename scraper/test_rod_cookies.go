package main

import (
	"fmt"
	"github.com/go-rod/rod"
)

func main() {
	browser := rod.New()
	fmt.Printf("%T\n", browser.SetCookies)
}
