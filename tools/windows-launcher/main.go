// Potato Launcher serves the bundled game on loopback without Node.js or network access.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed web
var content embed.FS

func gameHandler(files fs.FS) http.Handler {
	static := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		info, err := fs.Stat(files, name)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		static.ServeHTTP(w, r)
	})
}

func run() error {
	port := flag.Int("port", 4173, "Local port (keep the same port to retain browser data)")
	noOpen := flag.Bool("no-open", false, "Do not launch the browser automatically")
	flag.Parse()
	if *port < 1 || *port > 65535 {
		return fmt.Errorf("port must be 1-65535")
	}
	files, err := fs.Sub(content, "web")
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(*port)))
	if err != nil {
		return fmt.Errorf("cannot open local port %d; close the previous launcher or use --port 4174: %w", *port, err)
	}
	server := &http.Server{Handler: gameHandler(files), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/", *port)
	fmt.Println("GT WuWa - Potato Minesweeper | Offline Edition")
	fmt.Println("Open in your browser:", url)
	fmt.Println("Keep this window open. Press Ctrl+C or close this window to stop.")
	fmt.Println("Images and scores are saved in this browser, not inside the executable.")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	defer signal.Stop(stop)
	go func() { <-stop; _ = server.Close() }()
	if !*noOpen && runtime.GOOS == "windows" {
		if err := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url).Start(); err != nil {
			fmt.Println("Please open the above address manually:", err)
		}
	}
	err = server.Serve(listener)
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
func main() {
	if err := run(); err != nil {
		log.Println(err)
		if runtime.GOOS == "windows" {
			fmt.Println("Press Enter to close.")
			_, _ = fmt.Scanln()
		}
		os.Exit(1)
	}
}
