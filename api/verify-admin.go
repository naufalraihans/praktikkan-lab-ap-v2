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

var appVerifyAdmin *firebase.App

func initFirebaseVerifyAdmin() error {
	if appVerifyAdmin != nil {
		return nil
	}
	ctx := context.Background()
	serviceAccount := os.Getenv("FIREBASE_SERVICE_ACCOUNT")
	if serviceAccount == "" {
		return fmt.Errorf("FIREBASE_SERVICE_ACCOUNT is not set")
	}
	opt := option.WithCredentialsJSON([]byte(serviceAccount))
	var err error
	appVerifyAdmin, err = firebase.NewApp(ctx, nil, opt)
	return err
}

func sendJSONVerifyAdmin(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func VerifyAdminHandler(w http.ResponseWriter, r *http.Request) {
	// CORS headers
	w.Header().Set("Access-Control-Allow-Origin", "https://praktikkan-lab-ap.vercel.app")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != "POST" {
		sendJSONVerifyAdmin(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
		return
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
		sendJSONVerifyAdmin(w, http.StatusUnauthorized, map[string]interface{}{"isAdmin": false, "error": "No token provided"})
		return
	}

	if err := initFirebaseVerifyAdmin(); err != nil {
		fmt.Println("Firebase Init Error:", err)
		sendJSONVerifyAdmin(w, http.StatusInternalServerError, map[string]interface{}{"isAdmin": false, "error": "Internal Server Error"})
		return
	}

	ctx := context.Background()
	authClient, err := appVerifyAdmin.Auth(ctx)
	if err != nil {
		sendJSONVerifyAdmin(w, http.StatusInternalServerError, map[string]interface{}{"isAdmin": false, "error": "Failed to init auth client"})
		return
	}

	idToken := strings.TrimPrefix(authHeader, "Bearer ")
	token, err := authClient.VerifyIDToken(ctx, idToken)
	if err != nil {
		fmt.Println("Token Verification Error:", err)
		sendJSONVerifyAdmin(w, http.StatusUnauthorized, map[string]interface{}{"isAdmin": false, "error": "Invalid or expired token"})
		return
	}

	email, ok := token.Claims["email"].(string)
	if !ok || email == "" {
		sendJSONVerifyAdmin(w, http.StatusUnauthorized, map[string]interface{}{"isAdmin": false, "error": "No email in token"})
		return
	}
	nim := strings.Split(email, "@")[0]

	firestoreClient, err := appVerifyAdmin.Firestore(ctx)
	if err != nil {
		sendJSONVerifyAdmin(w, http.StatusInternalServerError, map[string]interface{}{"isAdmin": false, "error": "Failed to init firestore client"})
		return
	}
	defer firestoreClient.Close()

	docSnap, err := firestoreClient.Collection("mahasiswa").Doc(nim).Get(ctx)
	if err != nil {
		sendJSONVerifyAdmin(w, http.StatusForbidden, map[string]interface{}{"isAdmin": false, "error": "Not an admin"})
		return
	}

	data := docSnap.Data()
	role, ok := data["role"].(string)
	if !ok || role != "admin" {
		sendJSONVerifyAdmin(w, http.StatusForbidden, map[string]interface{}{"isAdmin": false, "error": "Not an admin"})
		return
	}

	sendJSONVerifyAdmin(w, http.StatusOK, map[string]interface{}{"isAdmin": true, "nim": nim})
}
