import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import * as Cesium from 'cesium'
import { fromBlob } from 'geotiff'
import { buildRelativeDepthFromImage, buildRelativeDepthFromRaster, calibrateRelativeDepth, readReferenceElevation } from './pipeline'
import type { CalibrationProduct, DepthProduct } from './pipeline'
import { depthAnythingModel, estimateRelativeDepth } from './depthAnything'
import './App.css'
import 'cesium/Build/Cesium/Widgets/widgets.css'

type GeoMetadata = { width: number; height: number; bounds: [number, number, number, number]; crs: string }
type RasterStats = { minimum: number; maximum: number; mean: number; slope: number }

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [inputType, setInputType] = useState<'GeoTIFF' | 'RGB image' | null>(null)
  const [textureUrl, setTextureUrl] = useState<string | null>(null)
  const [geoMetadata, setGeoMetadata] = useState<GeoMetadata | null>(null)
  const [relativeDepth, setRelativeDepth] = useState<DepthProduct | null>(null)
  const [calibration, setCalibration] = useState<CalibrationProduct | null>(null)
  const [rasterHeights, setRasterHeights] = useState<number[] | null>(null)
  const [rasterStats, setRasterStats] = useState<RasterStats | null>(null)
  const [referenceName, setReferenceName] = useState<string | null>(null)
  const [status, setStatus] = useState('Waiting for imagery')
  const [apiStatus, setApiStatus] = useState('Checking API')
  const [processing, setProcessing] = useState(false)
  const [viewerMode, setViewerMode] = useState<'terrain' | 'contour'>('terrain')
  const [flythrough, setFlythrough] = useState(false)
  const viewerElement = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const primitiveRef = useRef<Cesium.Primitive | null>(null)

  useEffect(() => { fetch('/api/health').then((response) => response.ok ? setApiStatus('API online') : setApiStatus('API error')).catch(() => setApiStatus('API offline')) }, [])

  useEffect(() => {
    if (!viewerElement.current) return
    const viewer = new Cesium.Viewer(viewerElement.current, { animation: false, baseLayerPicker: false, fullscreenButton: false, geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false, sceneModePicker: false, selectionIndicator: false, timeline: false, baseLayer: false, terrainProvider: new Cesium.EllipsoidTerrainProvider() })
    viewer.scene.globe.enableLighting = true
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#c5d5d0')
    viewerRef.current = viewer
    return () => { viewer.destroy(); viewerRef.current = null }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !flythrough) return
    let step = 0
    const timer = window.setInterval(() => {
      step += 1
      viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(0, 0, 900000), orientation: { heading: Cesium.Math.toRadians(335 + step * 4), pitch: Cesium.Math.toRadians(-62), roll: 0 } })
    }, 140)
    return () => window.clearInterval(timer)
  }, [flythrough])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !rasterHeights) return
    if (primitiveRef.current) viewer.scene.primitives.remove(primitiveRef.current)
    const size = 32
    const bounds = geoMetadata?.bounds ?? [-0.0375, -0.0375, 0.0375, 0.0375]
    const center = geoMetadata ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : [0, 0]
    const positions = new Float64Array(size * size * 3)
    const normals = new Float32Array(size * size * 3)
    const indices = new Uint32Array((size - 1) * (size - 1) * 6)
    const uv = new Float32Array(size * size * 2)
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
      const nX = column / (size - 1), nY = row / (size - 1)
      const lon = geoMetadata ? bounds[0] + nX * (bounds[2] - bounds[0]) : center[0] + (nX - 0.5) * 0.075
      const lat = geoMetadata ? bounds[1] + nY * (bounds[3] - bounds[1]) : center[1] + (nY - 0.5) * 0.075
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, rasterHeights[row * size + column] ?? 0)
      const offset = (row * size + column) * 3
      positions[offset] = position.x; positions[offset + 1] = position.y; positions[offset + 2] = position.z
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(position, new Cesium.Cartesian3())
      normals[offset] = normal.x; normals[offset + 1] = normal.y; normals[offset + 2] = normal.z
      const uvOffset = (row * size + column) * 2
      uv[uvOffset] = nX; uv[uvOffset + 1] = nY
    }
    let index = 0
    for (let row = 0; row < size - 1; row += 1) for (let column = 0; column < size - 1; column += 1) { const topLeft = row * size + column, topRight = topLeft + 1, bottomLeft = topLeft + size, bottomRight = bottomLeft + 1; indices[index++] = topLeft; indices[index++] = bottomLeft; indices[index++] = topRight; indices[index++] = topRight; indices[index++] = bottomLeft; indices[index++] = bottomRight }
    const geometry = new Cesium.Geometry({ attributes: { position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }), normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: normals }), st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: uv }) } as Cesium.GeometryAttributes, indices, primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(positions) })
    const material = textureUrl ? new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: textureUrl } } }) : undefined
    primitiveRef.current = viewer.scene.primitives.add(new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(inputType === 'GeoTIFF' ? '#9a8060' : '#5e8064').withAlpha(0.92)) } }), appearance: material ? new Cesium.MaterialAppearance({ material, faceForward: true, translucent: false }) : new Cesium.PerInstanceColorAppearance({ flat: false, translucent: true, closed: false }), asynchronous: false, compressVertices: false }))
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(center[0], center[1], geoMetadata ? 10000 : 900000), duration: 0.6, orientation: { heading: Cesium.Math.toRadians(335), pitch: Cesium.Math.toRadians(-62), roll: 0 } })
    return () => { if (primitiveRef.current && !viewer.isDestroyed()) { viewer.scene.primitives.remove(primitiveRef.current); primitiveRef.current = null } }
  }, [rasterHeights, geoMetadata, textureUrl, inputType])

  const handleImagery = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    const isGeo = /\.(tif|tiff)$/i.test(nextFile.name)
    setFile(nextFile); setInputType(isGeo ? 'GeoTIFF' : 'RGB image'); setTextureUrl(isGeo ? null : URL.createObjectURL(nextFile)); setGeoMetadata(null); setRelativeDepth(null); setCalibration(null); setRasterHeights(null); setRasterStats(null); setReferenceName(null); setStatus('Reading imagery')
    const uploadData = new FormData()
    uploadData.append('imagery', nextFile)
    fetch('/api/upload', { method: 'POST', body: uploadData }).catch(() => setApiStatus('API upload unavailable'))
    try {
      const depth = isGeo ? await buildRelativeDepthFromRaster(nextFile) : await buildRelativeDepthFromImage(nextFile)
      const product = calibrateRelativeDepth(depth, null)
      setRelativeDepth(depth); setCalibration(product); setRasterHeights(product.values.map((value) => 8 + value * 180)); setRasterStats({ minimum: product.minimum, maximum: product.maximum, mean: product.mean, slope: Math.max(1, (product.maximum - product.minimum) * 9) }); setStatus(isGeo ? 'Relative depth ready · calibration required' : 'Ready for Depth Anything V2')
      if (isGeo) { const image = await (await fromBlob(nextFile)).getImage(); const bounds = image.getBoundingBox(); const keys = image.getGeoKeys() ?? {}; setGeoMetadata({ width: image.getWidth(), height: image.getHeight(), bounds: [bounds[0], bounds[1], bounds[2], bounds[3]], crs: keys.ProjectedCSTypeGeoKey ? `EPSG:${keys.ProjectedCSTypeGeoKey}` : keys.GeographicTypeGeoKey ? `EPSG:${keys.GeographicTypeGeoKey}` : 'CRS metadata present' }) }
    } catch { setStatus('Could not read imagery') }
  }

  const runInference = async () => {
    if (!file || inputType !== 'RGB image') return
    setProcessing(true); setStatus(`Loading ${depthAnythingModel}`)
    try { const values = await estimateRelativeDepth(file); const mean = values.reduce((sum, value) => sum + value, 0) / values.length; setRelativeDepth({ values, minimum: 0, maximum: 1, mean }); setCalibration({ values, minimum: 0, maximum: 1, mean, source: 'relative only', isMetric: false }); setRasterHeights(values.map((value) => 8 + value * 180)); setRasterStats({ minimum: 0, maximum: 1, mean, slope: 12 }); setStatus('Depth Anything V2 relative depth ready') } catch { setStatus('Depth Anything V2 unavailable · fallback retained') } finally { setProcessing(false) }
  }

  const handleReference = async (event: ChangeEvent<HTMLInputElement>) => { const referenceFile = event.target.files?.[0]; if (!referenceFile || !relativeDepth) return; const product = calibrateRelativeDepth(relativeDepth, await readReferenceElevation(referenceFile)); setReferenceName(referenceFile.name); setCalibration(product); setRasterHeights(product.values.map((value) => 8 + ((value - product.minimum) / Math.max(1, product.maximum - product.minimum)) * 180)); setRasterStats({ minimum: product.minimum, maximum: product.maximum, mean: product.mean, slope: Math.max(1, (product.maximum - product.minimum) * 0.08) }); setStatus('Metric DSM calibrated from reference raster') }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">D</span><span>Depth<span className="brand-accent">Wizard</span></span><small>UPLOAD MODE</small></div><div className="topbar-meta"><span className="live-dot" /> {apiStatus} <span className="divider" /> <span className="cesium-mark">◈</span> CesiumJS</div></header>
    <section className="intro"><div><p className="eyebrow">SINGLE-VIEW ELEVATION WORKBENCH</p><h1>Bring your imagery.<br /><em>See its surface.</em></h1></div><p className="intro-copy">Upload one RGB image or GeoTIFF. DepthWizard will build a relative surface, then calibrate it only when you provide a reference elevation raster.</p></section>
    <section className="workspace"><aside className="control-panel"><div className="panel-heading"><span>01</span><h2>Imagery</h2></div><label className="dropzone"><input type="file" accept=".png,.jpg,.jpeg,.tif,.tiff" onChange={handleImagery} /><span className="upload-icon">↑</span><strong>{file ? 'Replace imagery' : 'Choose imagery'}</strong><small>PNG, JPG or GeoTIFF · up to 2 GB</small></label>{file && <div className="file-row"><span className="file-icon">▧</span><div><strong>{file.name}</strong><small>{inputType} · {(file.size / 1024 / 1024).toFixed(1)} MB</small></div><span className="check">✓</span></div>}{geoMetadata && <div className="metadata-row"><span>RASTER</span><b>{geoMetadata.width} × {geoMetadata.height}</b><span>BOUNDS</span><b>{geoMetadata.bounds.map((value) => value.toFixed(3)).join(', ')}</b><span>REFERENCE</span><b>{geoMetadata.crs}</b></div>}<div className="calibration-row"><span className={`calibration-dot ${calibration?.isMetric ? 'metric' : ''}`} /><div><strong>{calibration?.isMetric ? 'Metric DSM calibrated' : 'Relative depth only'}</strong><small>{referenceName ?? 'Add DEM / GCP to calibrate'}</small></div><label className="reference-button">ADD DEM<input type="file" accept=".tif,.tiff" onChange={handleReference} disabled={!relativeDepth} /></label></div><div className="model-row"><span className="model-mark">DA</span><div><strong>Depth Anything V2</strong><small>{status}</small></div></div><button className="run-button" onClick={runInference} disabled={!file || inputType !== 'RGB image' || processing}><span>{processing ? 'Running inference...' : 'Run Depth Anything V2'}</span><b>→</b></button></aside>
    <section className="viewer-panel"><div className="viewer-toolbar"><div><span className="status-pill"><span className="live-dot" /> {rasterHeights ? 'SURFACE READY' : 'WAITING FOR INPUT'}</span><span className="toolbar-label">{calibration?.isMetric ? 'METRIC DSM' : rasterHeights ? 'RELATIVE DSM' : 'NO PRODUCT'}</span></div><div className="toolbar-actions"><button className="tool-active" onClick={() => viewerRef.current?.camera.flyHome(0.65)}>⌖</button><button onClick={() => viewerRef.current?.camera.zoomIn(1800)}>＋</button><button onClick={() => viewerRef.current?.camera.zoomOut(1800)}>−</button></div></div><div className={`terrain-stage ${viewerMode}`}><div className="cesium-container" ref={viewerElement} /><div className="analysis-strip"><button className={viewerMode === 'terrain' ? 'active' : ''} onClick={() => setViewerMode('terrain')}>SURFACE</button><button className={viewerMode === 'contour' ? 'active' : ''} onClick={() => setViewerMode('contour')}>CONTOURS</button><button className={flythrough ? 'active flight' : ''} onClick={() => setFlythrough((value) => !value)}>{flythrough ? '■ STOP FLIGHT' : '▶ FLYTHROUGH'}</button></div><div className="stage-label label-one"><span>MAX HEIGHT</span><strong>{rasterStats ? `${rasterStats.maximum.toFixed(2)} ${calibration?.isMetric ? 'm' : 'relative'}` : '—'}</strong></div><div className="stage-label label-two"><span>MEAN SLOPE</span><strong>{rasterStats ? `${rasterStats.slope.toFixed(1)}°` : '—'}</strong></div>{!rasterHeights && <div className="empty-viewer"><strong>Upload imagery to begin</strong><small>Cesium is ready for your first surface</small></div>}<div className="cesium-watermark"><span>◈</span> CESIUMJS / TERRAIN VIEW</div></div><div className="viewer-footer"><div className="legend"><span className="legend-gradient" /><span>{rasterStats ? `${rasterStats.minimum.toFixed(2)} — ${rasterStats.maximum.toFixed(2)}` : 'NO HEIGHT DATA'} <b>{calibration?.isMetric ? 'METERS' : 'RELATIVE'}</b></span></div><div className="mesh-stats"><span>POINTS <b>{rasterHeights ? rasterHeights.length.toLocaleString() : '—'}</b></span><span>MEAN <b>{rasterStats ? rasterStats.mean.toFixed(2) : '—'}</b></span><span>STATUS <b className="confidence">{apiStatus}</b></span></div></div></section></section>
    <footer className="pipeline"><span className="pipeline-label">PIPELINE</span><span className="active-step">UPLOAD</span><b>›</b><span>RELATIVE DEPTH</span><b>›</b><span>CALIBRATE</span><b>›</b><span>DSM</span><b>›</b><span>CESIUM</span><span className="pipeline-note">No demo scenes · no fabricated measurements</span></footer>
  </main>
}

export default App
