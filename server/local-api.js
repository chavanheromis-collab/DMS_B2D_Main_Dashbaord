// Local stand-in for Vercel's serverless runtime.
//
// This does NOT reimplement any logic -- it just loads .env and hosts the
// exact same handler from api/sheets.js behind a plain Express server, so
// `npm run dev` works with zero Vercel CLI involvement. When you deploy to
// Vercel later, Vercel runs api/sheets.js itself (this file is never used
// in production/deployment -- it's local-dev-only).
import 'dotenv/config'
import express from 'express'
import sheetsHandler from '../api/sheets.js'
import driveHandler from '../api/drive.js'

const PORT = process.env.LOCAL_API_PORT || 3001

const app = express()
app.use(express.json())

// Vercel's (req, res) shape for Node functions is Express-compatible
// (res.status().json(), res.setHeader(), req.query, req.body, req.headers),
// so the handler works unchanged here.
app.all('/api/sheets', (req, res) => {
  sheetsHandler(req, res).catch((err) => {
    console.error('Unhandled error in /api/sheets:', err)
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
  })
})

// The 360° viewer's folder listing. Mounted the same way and for the same
// reason: locally there is no Vercel to run api/drive.js, and a viewer that
// works deployed and not on a developer's machine is one nobody can fix.
app.all('/api/drive', (req, res) => {
  driveHandler(req, res).catch((err) => {
    console.error('Unhandled error in /api/drive:', err)
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
  })
})

app.listen(PORT, () => {
  console.log(`Local /api server ready on http://localhost:${PORT}`)
  console.log('(Vite dev server proxies /api/* here -- see vite.config.js)')
})
