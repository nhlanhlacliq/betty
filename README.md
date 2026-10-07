# Betty (web app)

Voice co-pilot prototype. See CLAUDE.md for full project context.

    npm install
    npm run dev        # desktop: http://localhost:5173 (untick "Use real phone sensors" for a simulated session)
    npm test           # core logic + jsdom UI smoke tests
    npm run build      # static site in dist/

Phone sensors and speech need HTTPS (localhost is exempt): deploy `dist/` (Vercel etc.) to test on a phone.
Optional env vars: VITE_ANTHROPIC_API_KEY, VITE_TOMTOM_API_KEY (see .env.example). Both are visible in the browser.
