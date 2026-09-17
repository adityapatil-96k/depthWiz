import { fromBlob } from "geotiff";

export type DepthProduct = {
  values: number[];
  minimum: number;
  maximum: number;
  mean: number;
};

export type CalibrationProduct = DepthProduct & {
  source: "reference DEM" | "relative only";
  isMetric: boolean;
};

const summarize = (values: number[]): DepthProduct => {
  const valid = values.filter(Number.isFinite);
  const minimum = valid.length ? Math.min(...valid) : 0;
  const maximum = valid.length ? Math.max(...valid) : 0;
  const mean = valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : 0;
  return { values, minimum, maximum, mean };
};

export const buildRelativeDepthFromRaster = async (
  file: Blob,
  width = 32,
  height = 32,
): Promise<DepthProduct> => {
  const image = await (await fromBlob(file)).getImage();
  const raster = (await image.readRasters({
    interleave: true,
    width,
    height,
  })) as Float32Array | Uint16Array | Int16Array | Uint8Array;
  const values = Array.from(raster, Number);
  const product = summarize(values);
  const range = Math.max(1, product.maximum - product.minimum);
  return {
    ...product,
    values: values.map((value) =>
      Number.isFinite(value) ? (value - product.minimum) / range : 0,
    ),
  };
};

export const readReferenceElevation = async (
  file: Blob,
  width = 32,
  height = 32,
): Promise<DepthProduct> => {
  const image = await (await fromBlob(file)).getImage();
  const raster = (await image.readRasters({
    interleave: true,
    width,
    height,
  })) as Float32Array | Uint16Array | Int16Array | Uint8Array;
  return summarize(Array.from(raster, Number));
};

export const buildRelativeDepthFromImage = async (
  file: Blob,
  width = 32,
  height = 32,
): Promise<DepthProduct> => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const values = Array.from({ length: width * height }, (_, index) => {
    const offset = index * 4;
    return (
      (pixels[offset] * 0.299 +
        pixels[offset + 1] * 0.587 +
        pixels[offset + 2] * 0.114) /
      255
    );
  });
  return summarize(values);
};

export const calibrateRelativeDepth = (
  relative: DepthProduct,
  reference: DepthProduct | null,
): CalibrationProduct => {
  if (!reference)
    return { ...relative, source: "relative only", isMetric: false };
  const referenceRange = Math.max(1, reference.maximum - reference.minimum);
  const values = relative.values.map((value, index) => {
    const referenceValue = reference.values[index % reference.values.length];
    const referenceNormalized =
      (referenceValue - reference.minimum) / referenceRange;
    const blended = value * 0.35 + referenceNormalized * 0.65;
    return reference.minimum + blended * referenceRange;
  });
  return { ...summarize(values), source: "reference DEM", isMetric: true };
};
