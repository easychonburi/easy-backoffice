# EASY Backoffice — Firebase Spark (free) migration

This version uses Firebase Hosting, Firestore and Firebase Authentication only, so it can stay on the no-cost Spark plan. No Cloud Functions or Cloud Storage are required.

## Before the first deploy

Enable Email/Password authentication and create a Firestore database in `asia-southeast1`. The web app configuration is in `firebase-config.js`.

The legacy Google Sheet and Apps Script remain untouched until all Firebase functions have been tested.
