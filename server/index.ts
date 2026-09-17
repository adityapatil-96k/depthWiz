import cors from 'cors'
import express from 'express'
import multer from 'multer'

const app = express()
const upload = multer({ limits: { fileSize: 2 * 1024 * 1024 * 1024 }, storage: multer.memoryStorage() })
const port = Number(process.env.PORT ?? 8787)

app.use(cors())
app.get('/api/health', (_request, response) => response.json({ ok: true, service: 'depthwiz-api', inference: 'browser' }))
app.post('/api/upload', upload.single('imagery'), (request, response) => {
  if (!request.file) return response.status(400).json({ ok: false, error: 'No imagery file supplied' })
  const isGeoTiff = /\.(tif|tiff)$/i.test(request.file.originalname)
  return response.json({ ok: true, name: request.file.originalname, bytes: request.file.size, type: isGeoTiff ? 'GeoTIFF' : 'RGB image', inference: 'Depth Anything V2 runs in the browser' })
})
app.listen(port, () => console.log(`DepthWizard API listening on http://localhost:${port}`))
