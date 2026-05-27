package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"google.golang.org/api/option"
)

var appRunCode *firebase.App

func initFirebaseRunCode() error {
	if appRunCode != nil {
		return nil
	}
	ctx := context.Background()
	serviceAccount := os.Getenv("FIREBASE_SERVICE_ACCOUNT")
	if serviceAccount == "" {
		return fmt.Errorf("FIREBASE_SERVICE_ACCOUNT is not set")
	}
	opt := option.WithCredentialsJSON([]byte(serviceAccount))
	var err error
	appRunCode, err = firebase.NewApp(ctx, nil, opt)
	return err
}

func sendJSONRunCode(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func RunCodeHandler(w http.ResponseWriter, r *http.Request) {
	// CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "https://praktikkan-lab-ap.vercel.app")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != "POST" {
		sendJSONRunCode(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		sendJSONRunCode(w, http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
		return
	}

	if err := initFirebaseRunCode(); err != nil {
		fmt.Println("Firebase Init Error:", err)
		sendJSONRunCode(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}

	ctx := context.Background()
	authClient, err := appRunCode.Auth(ctx)
	if err != nil {
		sendJSONRunCode(w, http.StatusInternalServerError, map[string]string{"error": "Failed to init auth client"})
		return
	}

	idToken := strings.TrimPrefix(authHeader, "Bearer ")
	_, err = authClient.VerifyIDToken(ctx, idToken)
	if err != nil {
		fmt.Println("Token Verification Error:", err)
		sendJSONRunCode(w, http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
		return
	}

	var reqBody struct {
		Code  string `json:"code"`
		Lang  string `json:"lang"`
		Stdin string `json:"stdin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		sendJSONRunCode(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
		return
	}

	if reqBody.Code == "" || reqBody.Lang == "" {
		sendJSONRunCode(w, http.StatusBadRequest, map[string]string{"error": "Missing code or lang"})
		return
	}

	var compiler, options string
	if reqBody.Lang == "c" {
		compiler = "gcc-head"
		options = "-Wall"
	} else if reqBody.Lang == "python" {
		compiler = "cpython-3.14.0"
		options = ""
	} else {
		sendJSONRunCode(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("Language \"%s\" not supported", reqBody.Lang)})
		return
	}

	wandboxReqBody := map[string]string{
		"code":     reqBody.Code,
		"compiler": compiler,
		"options":  options,
		"stdin":    reqBody.Stdin,
	}
	wandboxReqBytes, _ := json.Marshal(wandboxReqBody)

	resp, err := http.Post("https://wandbox.org/api/compile.json", "application/json", strings.NewReader(string(wandboxReqBytes)))
	if err != nil {
		sendJSONRunCode(w, http.StatusBadGateway, map[string]interface{}{
			"output":   "",
			"error":    fmt.Sprintf("Code execution failed: %v", err),
			"exitCode": 1,
			"success":  false,
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		sendJSONRunCode(w, http.StatusBadGateway, map[string]interface{}{
			"output":   "",
			"error":    fmt.Sprintf("Wandbox error %d", resp.StatusCode),
			"exitCode": 1,
			"success":  false,
		})
		return
	}

	var wandboxRes map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&wandboxRes); err != nil {
		sendJSONRunCode(w, http.StatusInternalServerError, map[string]interface{}{
			"output":   "",
			"error":    "Failed to parse Wandbox response",
			"exitCode": 1,
			"success":  false,
		})
		return
	}

	output, _ := wandboxRes["program_output"].(string)
	compileError, _ := wandboxRes["compiler_error"].(string)
	programError, _ := wandboxRes["program_error"].(string)

	errStr := ""
	if compileError != "" {
		errStr = compileError
	} else if programError != "" {
		errStr = programError
	}

	var exitCode int
	if statusFloat, ok := wandboxRes["status"].(float64); ok {
		exitCode = int(statusFloat)
	} else if statusStr, ok := wandboxRes["status"].(string); ok && statusStr == "0" {
		exitCode = 0
	}

	success := exitCode == 0 && compileError == ""

	sendJSONRunCode(w, http.StatusOK, map[string]interface{}{
		"output":   output,
		"error":    errStr,
		"exitCode": exitCode,
		"success":  success,
	})
}
