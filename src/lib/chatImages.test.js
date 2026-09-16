import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  ACCEPT,
  IMAGE_TYPES,
  STALL_MS,
  driveNameFor,
  uploadProblem,
  MAX_EDGE,
  MAX_IMAGES,
  MAX_SOURCE_BYTES,
  bubbleSize,
  cleanImage,
  cleanImages,
  fitBox,
  hasImages,
  imageProblem,
  imagesFrom,
  imagesOf,
  isImageFile,
  photoText,
  roomFor,
} from './chatImages.js'
import { draftProblem, messageDoc } from './messages.js'
import { conversationsFor, entriesOf, previewOf } from './conversations.js'

// ---------------------------------------------------------------------
// Pictures in a chat
// ---------------------------------------------------------------------
// Half the messages anybody sends about a dashboard are "look at this",
// and the answer used to be a screenshot on WhatsApp. The things that must
// hold: only pictures, never the bytes in the message, and a bubble that
// draws what arrived rather than trusting it.

const file = (over = {}) => ({ name: 'shot.png', type: 'image/png', size: 200 * 1024, ...over })

// --- what may be sent ------------------------------------------------------

test('pictures, and nothing else', () => {
  assert.equal(isImageFile(file()), true)
  assert.equal(isImageFile(file({ type: 'image/jpeg' })), true)
  assert.equal(isImageFile(file({ type: 'image/heic', name: 'IMG_1.heic' })), true)
  // A chat that takes any file becomes a filing cabinet nobody maintains.
  assert.equal(isImageFile(file({ type: 'application/pdf', name: 'invoice.pdf' })), false)
  assert.equal(imageProblem(file({ type: 'application/pdf' })), 'Only pictures can be sent in a chat')
  assert.equal(imageProblem(null), 'No picture')
  assert.equal(imageProblem(file()), '')
})

test('what the picker offers is exactly what the app accepts', () => {
  // Two lists that drift apart is a file somebody is allowed to choose and
  // then told they cannot send.
  for (const kind of IMAGE_TYPES) {
    assert.equal(isImageFile(file({ type: `image/${kind}` })), true, kind)
    assert.ok(ACCEPT.includes(`image/${kind}`), kind)
  }
  // No wildcard: a source file carrying a slash-star is read as the start
  // of a comment by the guards that scan this project as text, and takes
  // the rest of the file with it.
  assert.equal(ACCEPT.includes('*'), false)
})

test('a picture nobody meant to send is refused before anything is uploaded', () => {
  // Said now, rather than after a thirty-second wait.
  assert.match(imageProblem(file({ size: MAX_SOURCE_BYTES + 1 })), /too big/)
  assert.equal(imageProblem(file({ size: MAX_SOURCE_BYTES - 1 })), '')
})

test('a paste carrying a picture and other things sends the picture', () => {
  const picked = imagesFrom([file(), file({ type: 'text/plain', name: 'note.txt' }), file({ name: 'b.jpg', type: 'image/jpeg' })])
  assert.deepEqual(picked.map((f) => f.name), ['shot.png', 'b.jpg'])
  assert.deepEqual(imagesFrom(null), [])
})

test('four to a message, and the room left is what may still be added', () => {
  const many = Array.from({ length: 9 }, (_, i) => file({ name: `${i}.png` }))
  assert.equal(imagesFrom(many).length, MAX_IMAGES)
  assert.equal(roomFor([1, 2]), MAX_IMAGES - 2)
  assert.equal(roomFor(new Array(MAX_IMAGES)), 0)
  assert.equal(imagesFrom(many, { max: roomFor(new Array(MAX_IMAGES)) }).length, 0)
})

// --- where it goes -----------------------------------------------------------

test('a picture is named after the person who sent it', () => {
  // The folder is a flat list somebody will open one day, and "who sent
  // this?" should be answerable there.
  const name = driveNameFor('u_ravi', 'Screenshot 2026.PNG')
  assert.ok(name.startsWith('u_ravi-'))
  assert.ok(name.endsWith('.png'), 'the kind is kept, in lower case')
  assert.ok(driveNameFor('u_ravi', 'no-extension').endsWith('.jpg'))
  // Never the same twice, or two screenshots in one minute are one file.
  assert.notEqual(driveNameFor('u_ravi', 'a.png'), driveNameFor('u_ravi', 'a.png'))
})

// --- what a message carries -----------------------------------------------------

test('a message keeps a link, never the picture itself', () => {
  const doc = messageDoc(
    { audience: 'people', to: ['u1'], body: 'look', images: [{ url: 'https://files/1.jpg', width: 1600, height: 900, path: 'chatImages/u/1.jpg' }] },
    { uid: 'me' }
  )
  assert.deepEqual(doc.images, [{ url: 'https://files/1.jpg', width: 1600, height: 900, path: 'chatImages/u/1.jpg' }])
  // And a plain message is exactly the document it always was.
  assert.equal('images' in messageDoc({ audience: 'people', to: ['u1'], body: 'hi' }, { uid: 'me' }), false)
})

test('a picture that is not one is not drawn', () => {
  // A message is a document somebody could write by hand.
  for (const bad of [null, 'x', {}, { url: '' }, { url: 'javascript:alert(1)' }, { url: 'data:image/png;base64,AAA' }, { url: 'http://files/1.jpg' }]) {
    assert.equal(cleanImage(bad), null, JSON.stringify(bad))
  }
  assert.deepEqual(cleanImage({ url: 'https://files/1.jpg' }), { url: 'https://files/1.jpg', width: 0, height: 0, path: '' })
  assert.equal(cleanImages(new Array(9).fill({ url: 'https://files/1.jpg' })).length, MAX_IMAGES)
  assert.deepEqual(cleanImages('nonsense'), [])
  assert.equal(hasImages({ images: [{ url: 'https://files/1.jpg' }] }), true)
  assert.equal(hasImages({ images: [{ url: 'ftp://x' }] }), false)
  assert.equal(imagesOf(null).length, 0)
})

test('a picture on its own is a message', () => {
  // "Look at this" needs no caption, and asking for one would be the app
  // demanding words it does not need.
  assert.equal(draftProblem({ audience: 'all', body: '' }), 'Write something first')
  assert.equal(draftProblem({ audience: 'all', body: '', images: [{ url: 'https://files/1.jpg' }] }), '')
  // But not a picture that is not one.
  assert.equal(draftProblem({ audience: 'all', body: '', images: [{ url: 'javascript:x' }] }), 'Write something first')
})

// --- how it reads ---------------------------------------------------------------

test('a chat that was sent a screenshot does not say “no messages yet”', () => {
  const m = {
    id: 'm1',
    from: 'ravi',
    to: ['me', 'ravi'],
    audience: 'people',
    body: '',
    images: [{ url: 'https://files/1.jpg' }, { url: 'https://files/2.jpg' }],
    createdAt: '2026-09-16T10:00:00.000Z',
    readBy: [],
    replies: [],
  }
  const [row] = conversationsFor([m], 'me', {})
  assert.equal(previewOf(row), '2 photos')
  assert.equal(previewOf({ ...row, lastMine: true }), 'You: 2 photos')
  // Words win when there are words.
  assert.equal(previewOf({ ...row, lastText: 'look at this', lastPhotos: 1 }), 'look at this')
  assert.equal(previewOf({ lastText: '' }), 'No messages yet')
  assert.equal(photoText(1), 'Photo')
  assert.equal(photoText(0), '')

  // And the bubble gets them.
  assert.equal(entriesOf([m], 'me', 'ravi')[0].images.length, 2)
  assert.equal('images' in entriesOf([{ ...m, images: [] }], 'me', 'ravi')[0], false)
})

test('a bubble is the right shape before the picture arrives', () => {
  // Otherwise the chat jumps as each one loads.
  assert.deepEqual(fitBox(3000, 2000, 1600), { width: 1600, height: 1067 })
  assert.deepEqual(fitBox(2000, 4000, 1600), { width: 800, height: 1600 })
  // Never enlarged: a small screenshot blown up is the same picture, blurred.
  assert.deepEqual(fitBox(400, 300, MAX_EDGE), { width: 400, height: 300 })
  assert.deepEqual(fitBox(0, 0), { width: 0, height: 0 })
  assert.deepEqual(bubbleSize({ width: 1600, height: 900 }, 220), { width: 220, height: 124 })
  // Unknown is a square, which is wrong in the least distracting way.
  assert.deepEqual(bubbleSize({}, 220), { width: 220, height: 220 })
})

// --- wiring ---------------------------------------------------------------------

const SRC = path.resolve(import.meta.dirname, '..')
const ROOT = path.resolve(SRC, '..')
const read = (p) =>
  fs
    .readFileSync(path.join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ')

test('an upload that stops moving is given up on, not waited out', () => {
  // The report this was written for: a 416KB photo "uploading" for twenty
  // minutes. It was not uploading -- the request had stalled, and nothing
  // on screen could tell that apart from slow.
  assert.ok(STALL_MS <= 30 * 1000, 'silence for longer than this is a dead upload')

  const hook = read('hooks/useChatImages.js')
  // XHR rather than fetch for one reason: it reports progress, and progress
  // is the only thing that tells a slow upload from a dead one.
  assert.ok(hook.includes('const request = new XMLHttpRequest()'))
  assert.ok(hook.includes('request.upload.onprogress'))
  assert.ok(hook.includes('if (Date.now() - moved > STALL_MS) {'))
  assert.ok(hook.includes('request.abort()'))
})

test('a failed upload names the cause, because the fixes are different', () => {
  // A folder not shared is an admin task; a folder out of space is a
  // different admin task; being signed out is neither.
  assert.match(uploadProblem({ stalled: true }), /stopped uploading/)
  assert.match(uploadProblem({ offline: true }), /connection dropped/)
  assert.match(uploadProblem({ status: 401 }), /signed out/)
  assert.match(uploadProblem({ status: 413 }), /too big/)
  // The one that means "in the wrong kind of Drive" rather than "broken".
  assert.match(uploadProblem({ status: 507 }), /Shared Drive/)
  assert.match(uploadProblem({ status: 403, message: 'Drive: no access' }), /share the Drive folder/)
  assert.equal(uploadProblem({}), 'That picture could not be sent')
  assert.equal(uploadProblem(undefined), 'That picture could not be sent')
})

test('the picture is shrunk in the browser before it is ever uploaded', () => {
  // A phone photo is three to six megabytes of something nobody looks at
  // full size in a bubble.
  const hook = read('hooks/useChatImages.js')
  assert.ok(hook.includes('const { blob, width, height } = await shrinkImage(file)'))
  assert.ok(hook.includes('const { id, link } = await send(blob, file.name, setPercent)'))
  // Through this app's own server: the browser holds no Drive access, the
  // service account does.
  assert.ok(hook.includes("request.open('POST', '/api/chatImage')"))
  assert.ok(hook.includes("request.setRequestHeader('Authorization', `Bearer ${token}`)"))
})

test('removing one takes the uploaded file with it, even mid-upload', () => {
  const hook = read('hooks/useChatImages.js')
  assert.ok(hook.includes('dropped.current.add(id)'))
  assert.ok(hook.includes('if (dropped.current.has(mine)) { remove(image.path) continue }'))
  assert.ok(hook.includes("fetch(`/api/chatImage?id=${encodeURIComponent(id)}`, { method: 'DELETE'"))
})

test('a folder that is not set up says so, rather than failing silently', () => {
  assert.ok(read('hooks/useChatImages.js').includes('setError(uploadProblem(e))'))
  // And the box shows how far it has got, not just that it is trying.
  assert.ok(read('components/Conversations.jsx').includes('{pictures.percent}%'))
})

// --- the folder they go to ------------------------------------------------

test('they go to one Drive folder, found before it is made, named exactly', () => {
  const drive = fs.readFileSync(path.join(ROOT, 'api/_lib/chatDrive.js'), 'utf8')
  assert.ok(drive.includes("export const CHAT_FOLDER = 'CUS Chat Images'"))
  // Found first, so an admin who made and shared it themselves gets theirs
  // rather than a second folder with the same name.
  assert.ok(drive.includes("mimeType = 'application/vnd.google-apps.folder'"))
  assert.ok(drive.includes("mimeType: 'application/vnd.google-apps.folder',"))
  // A Shared Drive is invisible to a plain query, and is the arrangement
  // that does not run out of space.
  assert.ok(drive.includes("supportsAllDrives: 'true'"))
  assert.ok(drive.includes('GOOGLE_DRIVE_CHAT_PARENT'))
  // Its own client and its own scope: the listing next door stays readonly,
  // as its own comment insists.
  assert.ok(drive.includes("scopes: ['https://www.googleapis.com/auth/drive']"))
  assert.ok(fs.readFileSync(path.join(ROOT, 'api/_lib/googleDrive.js'), 'utf8').includes('drive.readonly'))
})

test('the route is behind sign-in, takes pictures only, and is bounded', () => {
  const route = fs.readFileSync(path.join(ROOT, 'api/chatImage.js'), 'utf8')
  assert.ok(route.includes('await requireUser(req)'))
  assert.ok(route.includes('if (!IMAGE.test(String(mimeType'))
  assert.ok(route.includes('bytes.length > MAX_BYTES'))
  // Deleting is the dangerous one: a file id arriving from a browser must
  // not be able to delete anything else the service account can reach --
  // which is every spreadsheet this dashboard runs on.
  const drive = fs.readFileSync(path.join(ROOT, 'api/_lib/chatDrive.js'), 'utf8')
  assert.ok(drive.includes('if (!file?.parents?.includes(parent))'))
  // And it exists locally too, or pictures work deployed and nowhere else.
  assert.ok(fs.readFileSync(path.join(ROOT, 'server/local-api.js'), 'utf8').includes("app.all('/api/chatImage'"))
})

test('a Drive picture is drawn through the fallback, carrying no referrer', () => {
  // No single Drive endpoint serves every file, and Google refuses an image
  // request carrying a referrer from an origin it does not know -- which is
  // every deployment of this. A perfectly public file 403s without it.
  const chat = read('components/Conversations.jsx')
  assert.ok(chat.includes('const { url, exhausted, onError } = useImageFallback(image?.url, width)'))
  assert.ok(chat.includes('referrerPolicy="no-referrer"'))
  // All three places draw the same way -- the composer, the bubble, the
  // lightbox -- so none of them is the one that quietly stops working.
  assert.equal((chat.match(/<ChatImage image=\{image\}/g) || []).length, 3)
})

test('a message may be pictures alone, and no more than four', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
  const block = rules.slice(rules.indexOf('match /messages/'), rules.indexOf('match /dataSources/'))
  assert.ok(block.includes('(request.resource.data.body.size() > 0 || pictures().size() > 0)'))
  assert.ok(block.includes('pictures().size() <= 4'))
  assert.equal(MAX_IMAGES, 4, 'the app and the rule must agree')
})
