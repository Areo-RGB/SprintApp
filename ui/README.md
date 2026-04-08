<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/49d1e79f-9e5c-489f-88cb-4b40eefa069e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Backend Wiring (Local)

This UI is wired to the Windows backend through Vite proxy routes:

- `/api` -> `WINDOWS_UI_BACKEND_URL`
- `/ws` -> `WINDOWS_UI_BACKEND_URL`

Default backend target is `http://127.0.0.1:8787`.
Override it in `.env.local` when needed:

`WINDOWS_UI_BACKEND_URL="http://127.0.0.1:8787"`
