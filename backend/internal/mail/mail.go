// Package mail sends the app's emails: SMTP (Mailpit locally), a log-only sender,
// and an in-memory sender for tests.
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Message is one email with a plain-text and an HTML body.
type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

// Sender delivers a message.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// SMTP sends through an SMTP server. With no Username it doesn't authenticate
// (Mailpit). It upgrades to TLS when the server offers STARTTLS.
type SMTP struct {
	Host     string
	Port     int
	Username string
	Password string
	// From is the header value, e.g. "Budget Tracker <no-reply@budget-tracker.test>".
	From string
}

// Send delivers m. The context bounds the whole exchange.
func (s SMTP) Send(ctx context.Context, m Message) error {
	from, err := mail.ParseAddress(s.From)
	if err != nil {
		return fmt.Errorf("mail: parse from address %q: %w", s.From, err)
	}
	to, err := mail.ParseAddress(m.To)
	if err != nil {
		return fmt.Errorf("mail: parse to address: %w", err)
	}
	body, err := Compose(from, to, m, time.Now())
	if err != nil {
		return err
	}

	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("mail: dial %s: %w", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("mail: smtp hello: %w", err)
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("mail: starttls: %w", err)
		}
	}
	if s.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return fmt.Errorf("mail: auth: %w", err)
		}
	}
	if err := c.Mail(from.Address); err != nil {
		return fmt.Errorf("mail: MAIL FROM: %w", err)
	}
	if err := c.Rcpt(to.Address); err != nil {
		return fmt.Errorf("mail: RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA: %w", err)
	}
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("mail: write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: end data: %w", err)
	}
	return c.Quit()
}

// Compose renders a multipart/alternative message (text first, then HTML) with CRLF
// line endings and quoted-printable bodies.
func Compose(from, to *mail.Address, m Message, now time.Time) ([]byte, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)

	domain := "localhost"
	if _, d, ok := strings.Cut(from.Address, "@"); ok && d != "" {
		domain = d
	}
	id := make([]byte, 12)
	_, _ = rand.Read(id)

	h := []string{
		"From: " + from.String(),
		"To: " + to.String(),
		"Subject: " + mime.QEncoding.Encode("utf-8", m.Subject),
		"Date: " + now.Format(time.RFC1123Z),
		"Message-ID: <" + hex.EncodeToString(id) + "@" + domain + ">",
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=" + strconv.Quote(mw.Boundary()),
	}
	head := strings.Join(h, "\r\n") + "\r\n\r\n"

	for _, part := range []struct{ ctype, body string }{
		{"text/plain; charset=utf-8", m.Text},
		{"text/html; charset=utf-8", m.HTML},
	} {
		if part.body == "" {
			continue
		}
		pw, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.ctype},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, fmt.Errorf("mail: create part: %w", err)
		}
		qp := quotedprintable.NewWriter(pw)
		if _, err := io.WriteString(qp, strings.ReplaceAll(part.body, "\n", "\r\n")); err != nil {
			return nil, fmt.Errorf("mail: write part: %w", err)
		}
		if err := qp.Close(); err != nil {
			return nil, fmt.Errorf("mail: close part: %w", err)
		}
	}
	if err := mw.Close(); err != nil {
		return nil, fmt.Errorf("mail: close multipart: %w", err)
	}
	return append([]byte(head), buf.Bytes()...), nil
}

// Log writes emails to the log instead of sending them (MAIL_DRIVER=log).
type Log struct{ Logger *slog.Logger }

// Send logs m, including the text body (it holds the link to click).
func (l Log) Send(ctx context.Context, m Message) error {
	logger := l.Logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.InfoContext(ctx, "email (not sent: MAIL_DRIVER=log)", "to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}

// Memory keeps sent messages in memory (tests).
type Memory struct {
	mu   sync.Mutex
	sent []Message
	// Err, when set, is returned by Send (the message is still recorded).
	Err error
}

// Send records m.
func (s *Memory) Send(_ context.Context, m Message) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, m)
	return s.Err
}

// Sent returns a copy of every message so far.
func (s *Memory) Sent() []Message {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Message(nil), s.sent...)
}

// Last returns the most recent message sent to `to`.
func (s *Memory) Last(to string) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.sent) - 1; i >= 0; i-- {
		if strings.EqualFold(s.sent[i].To, to) {
			return s.sent[i], nil
		}
	}
	return Message{}, errors.New("mail: no message to " + to)
}
