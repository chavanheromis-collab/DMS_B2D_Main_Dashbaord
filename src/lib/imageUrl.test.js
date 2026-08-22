import test from 'node:test'
import assert from 'node:assert/strict'

import {
  driveFileId,
  driveImageUrl,
  imageCandidates,
  isDriveUrl,
  normalizeImageUrl,
  safeImageUrl,
} from './imageUrl.js'

// The exact link Drive hands you from the Share button.
const SHARE_LINK = 'https://drive.google.com/file/d/1DwTJ_9D2kLXTEiCtfwVlujupCzb-tOWV/view?usp=drive_link'
const ID = '1DwTJ_9D2kLXTEiCtfwVlujupCzb-tOWV'

test('the id is found in every Drive URL shape', () => {
  assert.equal(driveFileId(SHARE_LINK), ID)
  assert.equal(driveFileId(`https://drive.google.com/file/d/${ID}/view`), ID)
  assert.equal(driveFileId(`https://drive.google.com/open?id=${ID}`), ID)
  assert.equal(driveFileId(`https://drive.google.com/uc?export=view&id=${ID}`), ID)
  assert.equal(driveFileId(`https://lh3.googleusercontent.com/d/${ID}`), ID)
  // Ids contain underscores and hyphens, which a lazier pattern would cut.
  assert.ok(ID.includes('_') && ID.includes('-'))
})

test('a bare id pasted on its own is accepted', () => {
  assert.equal(driveFileId(ID), ID)
})

test('non-Drive URLs are left alone', () => {
  assert.equal(driveFileId('https://example.com/logo.png'), '')
  assert.equal(driveFileId(''), '')
  assert.equal(driveFileId(null), '')
  // A short word is not a file id.
  assert.equal(driveFileId('logo'), '')
})

test('a share link becomes a URL that actually serves the image', () => {
  const url = normalizeImageUrl(SHARE_LINK, { width: 100 })
  // Google's own image CDN, which is the most reliable for embedding.
  assert.ok(url.startsWith('https://lh3.googleusercontent.com/d/'))
  assert.ok(url.includes(ID))
  // NOT the /view page, which would load HTML into an <img> and show nothing.
  assert.ok(!url.includes('/view'))
})

test('images are fetched at twice their display size for retina', () => {
  // A 20px icon fetched at 20px is visibly soft on a modern screen.
  assert.ok(normalizeImageUrl(SHARE_LINK, { width: 20 }).endsWith('=w40'))
  assert.ok(normalizeImageUrl(SHARE_LINK, { width: 200 }).endsWith('=w400'))
  // The width reaches every candidate, not just the first.
  for (const url of imageCandidates(SHARE_LINK, { width: 20 })) {
    assert.ok(url.includes('w40') || url.includes('export=view'), url)
  }
})

test('a plain image URL passes through untouched', () => {
  const direct = 'https://example.com/a-b_c.png?v=2'
  assert.equal(normalizeImageUrl(direct), direct)
})

test('the allow-list runs on the REWRITTEN url, not the typed one', () => {
  // The Drive share link carries a query string and the rewrite adds its own
  // punctuation. Both must survive, or every Drive image would be silently
  // rejected by the URL check.
  const rewritten = safeImageUrl(SHARE_LINK)
  assert.ok(rewritten.includes(ID))
  assert.ok(!rewritten.includes('/view'))
  assert.equal(safeImageUrl('https://example.com/img.png'), 'https://example.com/img.png')
})

test('unsafe or non-image URLs are still rejected', () => {
  assert.equal(safeImageUrl('javascript:alert(1)'), '')
  assert.equal(safeImageUrl('data:text/html,<script>'), '')
  assert.equal(safeImageUrl('https://e.com/a.jpg");background:red;("'), '')
  assert.equal(safeImageUrl('https://e.com/a b.jpg'), '')
  assert.equal(safeImageUrl(''), '')
  assert.equal(safeImageUrl(null), '')
})

test('data:image URLs are still allowed', () => {
  assert.equal(safeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
})

test('isDriveUrl flags exactly the links that need sharing checked', () => {
  assert.equal(isDriveUrl(SHARE_LINK), true)
  assert.equal(isDriveUrl('https://example.com/logo.png'), false)
})

test('driveImageUrl rounds the width rather than emitting a fraction', () => {
  assert.ok(driveImageUrl(ID, 33.7).endsWith('=w34'))
})

// --- candidate fallback -------------------------------------------------

test('a Drive file offers several endpoints to try, best first', () => {
  // No single Drive endpoint serves every file, which is why one URL alone
  // kept failing. The component walks these on error.
  const list = imageCandidates(SHARE_LINK, { width: 100 })
  assert.equal(list.length, 3)
  assert.ok(list[0].startsWith('https://lh3.googleusercontent.com/d/'), 'the image CDN first')
  assert.ok(list[1].includes('drive.google.com/thumbnail'))
  assert.ok(list[2].includes('export=view'), 'the interstitial-prone one last')
  for (const url of list) assert.ok(url.includes(ID))
})

test('a plain URL has exactly one candidate: itself', () => {
  assert.deepEqual(imageCandidates('https://example.com/a.png'), ['https://example.com/a.png'])
})

test('unsafe candidates never make the list', () => {
  assert.deepEqual(imageCandidates('javascript:alert(1)'), [])
  assert.deepEqual(imageCandidates(''), [])
  assert.deepEqual(imageCandidates(null), [])
})

test('the single-URL helper agrees with the first candidate', () => {
  // CSS backgrounds cannot retry, so they take the best one and must not
  // disagree with what an <img> would try first.
  assert.equal(driveImageUrl(ID, 200), imageCandidates(SHARE_LINK, { width: 100 })[0])
  assert.equal(safeImageUrl(SHARE_LINK, { width: 100 }), imageCandidates(SHARE_LINK, { width: 100 })[0])
})
