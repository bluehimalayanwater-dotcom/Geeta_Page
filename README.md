# 🕉️ Dharmic Wisdom Explainer - Deployment Guide

This application is designed to be hosted as a static site. Follow these steps to deploy it to **GitHub Pages**.

## 🚀 Quick Start (Manual Upload)

1. **Create a Repository**: Create a new repository on GitHub named `dharmic-wisdom`.
2. **Upload Files**: Upload the following files directly to the root of the repository:
   - `index.html`
   - `index.tsx`
   - `App.tsx`
   - `constants.ts`
   - `types.ts`
   - `metadata.json`
   - `services/audioUtils.ts`
   - `components/PersonaCard.tsx`
   - `components/AudioVisualizer.tsx`
3. **Enable Pages**: Go to **Settings > Pages**. Under "Build and deployment", set the source to "Deploy from a branch" and select `main` (or `master`) as the branch and `/ (root)` as the folder.
4. **API Key Management**: 
   - **Crucial**: This app requires a `process.env.API_KEY`. 
   - If you are using a local build tool like Vite, add your key to a `.env` file (`VITE_API_KEY=...`).
   - For a production deployment on GitHub Pages without a build step, you may need to modify `App.tsx` to safely handle the API key (e.g., using a proxy or a secure input if not injected by your environment).
   - *Note*: Ensure you never commit your private API key to a public repository.

## 🛠️ Advanced Deployment (GitHub Actions)

For a professional CI/CD pipeline:

1. Use a tool like **Vite** to wrap these files.
2. Create a GitHub Secret named `GEMINI_API_KEY`.
3. Use a `.github/workflows/deploy.yml` to build the app and inject the secret during the build process using `vite`'s environment variable system.

## ✨ Features
- **Real-time Voice Modulation**: Low-latency spiritual guidance.
- **Satsang Transcripts**: Live text-to-speech feedback.
- **Spiritual UI/UX**: Designed with Hindu iconography and color palettes.
- **Mobile Responsive**: Access wisdom on the go.

---
*Made with Devotion by Adesh Bhumihar*
