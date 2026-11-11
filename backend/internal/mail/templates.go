package mail

import (
	"bytes"
	htmltemplate "html/template"
	texttemplate "text/template"
)

type linkData struct {
	Title   string
	Intro   string
	Action  string
	Link    string
	Expires string
	Outro   string
}

var textTmpl = texttemplate.Must(texttemplate.New("text").Parse(`{{.Title}}

{{.Intro}}

{{.Action}}:
{{.Link}}

{{.Expires}}

{{.Outro}}

— Budget Tracker
`))

var htmlTmpl = htmltemplate.Must(htmltemplate.New("html").Parse(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{.Title}}</title></head>
<body style="margin:0;padding:0;background:#F2F2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#000;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F2F7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:16px;padding:32px 28px;">
<tr><td>
<h1 style="margin:0 0 12px;font-size:22px;line-height:28px;font-weight:700;">{{.Title}}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:22px;color:#3C3C43;">{{.Intro}}</p>
<p style="margin:0 0 24px;"><a href="{{.Link}}" style="display:inline-block;background:#007AFF;color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:12px;">{{.Action}}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#6C6C70;">{{.Expires}}</p>
<p style="margin:0 0 16px;font-size:14px;line-height:20px;color:#6C6C70;">{{.Outro}}</p>
<p style="margin:0;font-size:12px;line-height:16px;color:#8E8E93;word-break:break-all;">If the button doesn’t work, paste this link into your browser:<br>{{.Link}}</p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#8E8E93;">Budget Tracker</p>
</td></tr>
</table>
</body>
</html>
`))

func render(to string, d linkData) Message {
	var text, html bytes.Buffer
	// The templates are fixed and the data are strings, so execution can't fail.
	_ = textTmpl.Execute(&text, d)
	_ = htmlTmpl.Execute(&html, d)
	return Message{To: to, Subject: d.Title, Text: text.String(), HTML: html.String()}
}

// VerifyEmail is the "confirm your address" email. The link is valid for 24 hours.
func VerifyEmail(to, link string) Message {
	return render(to, linkData{
		Title:   "Confirm your email address",
		Intro:   "Tap the button to confirm this is your address. It keeps your account safe and lets you reset your password if you ever forget it.",
		Action:  "Confirm Email",
		Link:    link,
		Expires: "The link works for 24 hours.",
		Outro:   "Didn’t create a Budget Tracker account? You can ignore this email.",
	})
}

// ResetPassword is the password reset email. The link is valid for 1 hour.
func ResetPassword(to, link string) Message {
	return render(to, linkData{
		Title:   "Reset your password",
		Intro:   "Someone asked to reset the password for your Budget Tracker account. If it was you, choose a new one.",
		Action:  "Choose a New Password",
		Link:    link,
		Expires: "The link works for 1 hour and signs you out everywhere once used.",
		Outro:   "Didn’t ask for this? You can ignore this email. Your password stays the same.",
	})
}
