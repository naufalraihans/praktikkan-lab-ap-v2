package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

func sendJSONGrade(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func GradeHandler(w http.ResponseWriter, r *http.Request) {
	// CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != "POST" {
		sendJSONGrade(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	var reqBody struct {
		Prompt string `json:"prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		sendJSONGrade(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON body"})
		return
	}

	if reqBody.Prompt == "" {
		sendJSONGrade(w, http.StatusBadRequest, map[string]string{"error": "Missing prompt"})
		return
	}

	apiKey := os.Getenv("OLLAMA_API_KEY")
	if apiKey == "" {
		apiKey = "8bda7b1f64be481cbb67b65337c51247.upYzKyr87mHTzVqPgz0YD_pb"
	}

	ollamaReqBody := map[string]interface{}{
		"model": "gpt-oss:120b",
		"messages": []map[string]string{
			{"role": "user", "content": reqBody.Prompt},
		},
		"stream": false,
		"options": map[string]interface{}{
			"temperature": 0,
			"top_p":       1,
		},
	}
	ollamaReqBytes, _ := json.Marshal(ollamaReqBody)

	req, err := http.NewRequest("POST", "https://ollama.com/api/chat", bytes.NewReader(ollamaReqBytes))
	if err != nil {
		sendJSONGrade(w, http.StatusInternalServerError, map[string]string{"error": "Failed to create request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		sendJSONGrade(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errorRes map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&errorRes)
		sendJSONGrade(w, resp.StatusCode, map[string]interface{}{"error": fmt.Sprintf("Ollama error %d", resp.StatusCode), "details": errorRes})
		return
	}

	var ollamaRes map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&ollamaRes); err != nil {
		sendJSONGrade(w, http.StatusInternalServerError, map[string]string{"error": "Failed to parse Ollama response"})
		return
	}

	// grading.js expects: data.message
	if message, ok := ollamaRes["message"]; ok {
		sendJSONGrade(w, http.StatusOK, map[string]interface{}{"message": message})
	} else {
		sendJSONGrade(w, http.StatusInternalServerError, map[string]string{"error": "No message in Ollama response"})
	}
}
