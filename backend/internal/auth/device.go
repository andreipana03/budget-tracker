package auth

import "strings"

// DeviceName derives a short label like "Safari on macOS" from a User-Agent, for the
// sessions list. It returns "" when nothing useful can be read.
func DeviceName(userAgent string) string {
	ua := userAgent
	if ua == "" {
		return ""
	}
	browser := ""
	switch {
	case strings.Contains(ua, "BudgetTracker"):
		browser = "Budget Tracker"
	case strings.Contains(ua, "Edg/"), strings.Contains(ua, "EdgiOS/"), strings.Contains(ua, "EdgA/"):
		browser = "Edge"
	case strings.Contains(ua, "OPR/"), strings.Contains(ua, "Opera"):
		browser = "Opera"
	case strings.Contains(ua, "Firefox/"), strings.Contains(ua, "FxiOS/"):
		browser = "Firefox"
	case strings.Contains(ua, "CriOS/"), strings.Contains(ua, "Chrome/"), strings.Contains(ua, "Chromium/"):
		browser = "Chrome"
	case strings.Contains(ua, "Safari/"), strings.Contains(ua, "AppleWebKit/"):
		browser = "Safari"
	case strings.HasPrefix(ua, "curl/"):
		browser = "curl"
	}

	os := ""
	switch {
	case strings.Contains(ua, "iPhone"):
		os = "iPhone"
	case strings.Contains(ua, "iPad"):
		os = "iPad"
	case strings.Contains(ua, "Android"):
		os = "Android"
	case strings.Contains(ua, "CrOS"):
		os = "ChromeOS"
	case strings.Contains(ua, "Macintosh"), strings.Contains(ua, "Mac OS X"):
		os = "macOS"
	case strings.Contains(ua, "Windows"):
		os = "Windows"
	case strings.Contains(ua, "Linux"):
		os = "Linux"
	}

	switch {
	case browser != "" && os != "":
		return browser + " on " + os
	case browser != "":
		return browser
	default:
		return os
	}
}
