package mail

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
	"time"
)

func TestComposeIsValidMultipart(t *testing.T) {
	from, _ := mail.ParseAddress("Budget Tracker <no-reply@budget-tracker.test>")
	to, _ := mail.ParseAddress("ana@example.com")
	m := VerifyEmail("ana@example.com", "http://localhost:5173/verify-email?token=abc_DEF-123")
	raw, err := Compose(from, to, m, time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("read message: %v", err)
	}
	for _, h := range []string{"From", "To", "Subject", "Date", "Message-Id", "Mime-Version"} {
		if msg.Header.Get(h) == "" {
			t.Errorf("missing header %s", h)
		}
	}
	if !strings.HasSuffix(msg.Header.Get("Message-Id"), "@budget-tracker.test>") {
		t.Errorf("Message-ID = %q", msg.Header.Get("Message-Id"))
	}
	subject, _ := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if subject != "Confirm your email address" {
		t.Errorf("subject = %q", subject)
	}
	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/alternative" {
		t.Fatalf("content type %q: %v", mediaType, err)
	}
	r := multipart.NewReader(msg.Body, params["boundary"])
	var types []string
	for {
		p, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(p) // multipart decodes quoted-printable
		if !strings.Contains(string(body), "token=abc_DEF-123") {
			t.Errorf("%s part lacks the link: %s", p.Header.Get("Content-Type"), body)
		}
		types = append(types, p.Header.Get("Content-Type"))
	}
	if strings.Join(types, ",") != "text/plain; charset=utf-8,text/html; charset=utf-8" {
		t.Fatalf("parts = %v", types)
	}
}

func TestTemplates(t *testing.T) {
	v := VerifyEmail("a@b.co", "https://x/verify-email?token=t&x=<y>")
	if v.Subject != "Confirm your email address" || !strings.Contains(v.Text, "24 hours") {
		t.Fatalf("verify: %+v", v)
	}
	if strings.Contains(v.HTML, "<y>") {
		t.Fatal("HTML link not escaped")
	}
	r := ResetPassword("a@b.co", "https://x/reset-password?token=t")
	if r.Subject != "Reset your password" || !strings.Contains(r.Text, "1 hour") || !strings.Contains(r.HTML, "reset-password?token=t") {
		t.Fatalf("reset: %+v", r)
	}
}

func TestMemory(t *testing.T) {
	var m Memory
	_ = m.Send(context.Background(), Message{To: "a@b.co", Subject: "1"})
	_ = m.Send(context.Background(), Message{To: "a@b.co", Subject: "2"})
	last, err := m.Last("A@b.co")
	if err != nil || last.Subject != "2" || len(m.Sent()) != 2 {
		t.Fatalf("last=%+v err=%v", last, err)
	}
}
