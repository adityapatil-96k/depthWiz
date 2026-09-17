# DepthWizard

DepthWizard is a prototype for turning one RGB image or GeoTIFF into a navigable 3D surface.

## Current workflow

1. Upload PNG, JPG, or GeoTIFF imagery.
2. Run Depth Anything V2 for relative depth on RGB imagery.
3. Inspect the generated CesiumJS surface.
4. Optionally upload a DEM/GCP GeoTIFF to calibrate relative depth into a metric DSM.

GeoTIFF metadata alone does not make a metric DSM. A reference elevation raster is required for calibration.

## Run locally

```powershell
npm install
npm run dev:full
```

Frontend: http://localhost:5173  
API health: http://localhost:8787/api/health

The first RGB reconstruction downloads and caches the Depth Anything V2 ONNX model in the browser. WebGPU is attempted first, with WASM fallback.

## Validation

```powershell
npm run build
npm run lint
```

This is a prototype. The generated mesh is downsampled for interactive browser visualization; production DSM accuracy, DEM/GCP alignment, and quantitative RMSE/MAE evaluation remain future work.
