import { createRegionGrid } from "./region.ts";
import { fetchRaster } from "./raster.ts";
import type { dataBundle, LandfireVersion, VegetationValues } from "./types.ts";

const products = ["FBFM40", "EVT", "CC", "CH", "CBH", "CBD"] as const;
type Product = typeof products[number];
const versions: LandfireVersion[] = ["LF2020", "LF2022", "LF2023", "LF2024", "LF2025"];

/** Preserve categorical codes; convert scaled canopy measurements to physical units. */
export function normalizeLandfireValues(values: Record<Product, number | null>): VegetationValues {
  function value(product: Product, scale = 1): number | null {
    const raw = values[product];
    if (raw === null || raw === -9999) return null;
    if (!Number.isInteger(raw) || raw < 0) throw new Error(`Invalid LANDFIRE ${product} value.`);
    if (product === "FBFM40" && raw === 0) return null;
    if (product === "CC" && raw > 100) throw new Error("Invalid LANDFIRE canopy cover.");
    return raw / scale;
  }
  return {
    fuel_model_code: value("FBFM40"),
    vegetation_type_code: value("EVT"),
    canopy_cover_pct: value("CC"),
    canopy_height_m: value("CH", 10),
    canopy_base_height_m: value("CBH", 10),
    canopy_bulk_density_kg_m3: value("CBD", 100),
  };
}

/** Raw category-preserving samples of six versioned LANDFIRE CONUS products. */
export async function getVegetationAttributes(
  lat: number, long: number, options: { version?: LandfireVersion } = {},
): Promise<Pick<dataBundle, "vegetation">> {
  const version = options.version ?? "LF2025";
  if (!versions.includes(version)) throw new Error("Unsupported LANDFIRE version.");
  const grid = createRegionGrid(lat, long, 1);
  const layers = await Promise.all(products.map(async product => {
    const service = `https://lfps.usgs.gov/arcgis/rest/services/Landfire_${version}/${version}_${product}_CONUS/ImageServer`;
    const raster = await fetchRaster(service, grid.bounds, grid.columns, grid.rows, "nearest");
    return { product, service, raster };
  }));
  const cells = grid.cells.map((location, index) => ({
    ...location,
    ...normalizeLandfireValues(Object.fromEntries(layers.map(({ product, raster }) =>
      [product, raster.values[index] ?? null])) as Record<Product, number | null>),
  }));
  return {
    vegetation: {
      source: "LANDFIRE", version, source_resolution_m: 30, resampling: "nearest",
      fuel_model_system: "Scott and Burgan 40",
      source_urls: layers.map(layer => layer.service),
      fetched_at: layers.map(layer => layer.raster.fetched_at).sort()[0]!,
      grid: { bounds: grid.bounds, rows: grid.rows, columns: grid.columns, cells },
    },
  };
}
