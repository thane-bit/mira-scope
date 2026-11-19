# MIRA Scope — web app

A static Next.js app (`output: "export"`). Paste or upload a paper, paste your own OpenRouter key, pick **Discourse graph** or **Outcomes graph**, and extraction runs in your browser via the shared engine in `../src`. Then review/edit the draft and export JSON-LD (discourse) or a zipped Obsidian vault (outcomes).

```bash
npm install
npm run dev            # http://localhost:3030
npm run build          # static site in out/
```

Set `NEXT_PUBLIC_BASE_PATH=/<repo>` when building for GitHub Pages project sites (the `pages` workflow does this). The key is held in memory only; it is never written to disk or sent anywhere except OpenRouter.
