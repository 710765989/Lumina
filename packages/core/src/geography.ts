import exifr from 'exifr';
import sharp from 'sharp';
import cityRows from './data/cities.json' with { type: 'json' };

type Place = { country: string; region: string; city: string; latitude: number; longitude: number; vector: number[] };
type Node = { place: Place; axis: number; left?: Node; right?: Node };
const vector = (latitude: number, longitude: number) => {
  const lat = latitude * Math.PI / 180; const lon = longitude * Math.PI / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
};
let tree: Node | undefined;
function build(rows: Place[], depth = 0): Node | undefined {
  if (!rows.length) return undefined;
  const axis = depth % 3; rows.sort((a, b) => a.vector[axis]! - b.vector[axis]!);
  const middle = Math.floor(rows.length / 2);
  return { place: rows[middle]!, axis, left: build(rows.slice(0, middle), depth + 1), right: build(rows.slice(middle + 1), depth + 1) };
}
export function nearbyPlace(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  tree ??= build((cityRows as [string, string, string, number, number][]).map(([country, region, city, lat, lon]) => ({ country, region, city, latitude: lat, longitude: lon, vector: vector(lat, lon) })));
  const target = vector(latitude, longitude); let best: Place | undefined; let distance = Infinity;
  function visit(node: Node | undefined) {
    if (!node) return;
    const squared = node.place.vector.reduce((sum, component, index) => sum + (component - target[index]!) ** 2, 0);
    if (squared < distance) { distance = squared; best = node.place; }
    const delta = target[node.axis]! - node.place.vector[node.axis]!;
    visit(delta < 0 ? node.left : node.right); if (delta * delta < distance) visit(delta < 0 ? node.right : node.left);
  }
  visit(tree);
  if (!best) return null;
  const { vector: _, ...place } = best as Place;
  const distanceKm = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(distance) / 2));
  // Do not invent an administrative location for remote areas or open sea.
  return distanceKm > 150 ? null : { ...place, distanceKm: Math.round(distanceKm * 10) / 10, placeSource: 'nearby-city' };
}
export async function extractMetadata(file: string) {
  const metadata = await sharp(file, { failOn: 'none' }).metadata();
  let exif: Record<string, any> = {};
  try { exif = await exifr.parse(file, { tiff: true, exif: true, gps: true, xmp: true, icc: false, iptc: true }) ?? {}; } catch { /* Valid images without EXIF are common. */ }
  const taken = exif.DateTimeOriginal ?? exif.CreateDate;
  return {
    width: (metadata.orientation ?? 0) >= 5 ? metadata.height : metadata.width,
    height: (metadata.orientation ?? 0) >= 5 ? metadata.width : metadata.height,
    format: metadata.format, colorSpace: metadata.space, orientation: metadata.orientation,
    animationVersion:1,animated:(metadata.pages??1)>1 && ['gif','webp','png'].includes(metadata.format??''),frames:metadata.pages??1,
    capturedAtMs: taken instanceof Date && Number.isFinite(taken.getTime()) ? taken.getTime() : null,
    camera: [exif.Make, exif.Model].filter(Boolean).join(' '), lens: exif.LensModel ?? '',
    iso: exif.ISO ?? null, aperture: exif.FNumber ?? null, exposure: exif.ExposureTime ?? null, focalLength: exif.FocalLength ?? null,
    ...(Number.isFinite(exif.latitude) && Number.isFinite(exif.longitude) ? { latitude: exif.latitude as number, longitude: exif.longitude as number } : {}),
  };
}
