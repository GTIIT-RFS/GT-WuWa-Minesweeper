package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBundledGame(t *testing.T) {
	files, err := fs.Sub(content, "web")
	if err != nil {
		t.Fatal(err)
	}
	handler := gameHandler(files)
	for _, path := range []string{"/", "/potato.svg"} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != http.StatusOK {
			t.Fatalf("%s: %d", path, r.Code)
		}
		if r.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing nosniff")
		}
	}
	r := httptest.NewRecorder()
	handler.ServeHTTP(r, httptest.NewRequest("GET", "/", nil))
	if !strings.Contains(r.Body.String(), "<div id=\"root\">") {
		t.Fatal("missing application root")
	}
	for _, path := range []string{"/missing", "/assets/", "/../go.mod", "/main.go"} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 404 {
			t.Fatalf("unexpected file disclosure at %s: %d", path, r.Code)
		}
	}
	r = httptest.NewRecorder()
	handler.ServeHTTP(r, httptest.NewRequest("POST", "/", nil))
	if r.Code != 405 {
		t.Fatal("write methods must be refused")
	}
}
