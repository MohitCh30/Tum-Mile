/**
 * Location, deliberately blunt.
 *
 * Coordinates are never stored. The client sends a position once, the
 * server immediately reduces it to a 5-character geohash — a cell roughly
 * 5km x 5km — and stores only that. There is no column that could leak an
 * exact position, because the value never survives the request that
 * carried it.
 *
 * Distance is then computed cell-centre to cell-centre and reported as a
 * band, never a number. Two people in the same cell read as "close by",
 * which is as precise as this product ever gets.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** The only precision this app uses. Finer cells would narrow someone down. */
export const GEOHASH_PRECISION = 5;

export function encodeGeohash(lat: number, lon: number, precision = GEOHASH_PRECISION): string {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;

  let hash = "";
  let bits = 0;
  let bit = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        bit = (bit << 1) + 1;
        lonMin = mid;
      } else {
        bit = bit << 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        bit = (bit << 1) + 1;
        latMin = mid;
      } else {
        bit = bit << 1;
        latMax = mid;
      }
    }

    even = !even;
    bits += 1;

    if (bits === 5) {
      hash += BASE32[bit];
      bits = 0;
      bit = 0;
    }
  }

  return hash;
}

export function decodeGeohash(hash: string): { lat: number; lon: number } | null {
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let even = true;

  for (const char of hash) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) return null;

    for (let n = 4; n >= 0; n--) {
      const bit = (idx >> n) & 1;
      if (even) {
        const mid = (lonMin + lonMax) / 2;
        if (bit === 1) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit === 1) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }

  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Cell-centre to cell-centre. Null when either side has no location. */
export function distanceKm(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;

  const pa = decodeGeohash(a);
  const pb = decodeGeohash(b);
  if (!pa || !pb) return null;

  const dLat = toRadians(pb.lat - pa.lat);
  const dLon = toRadians(pb.lon - pa.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(pa.lat)) * Math.cos(toRadians(pb.lat)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * What a person is actually shown. Repeated observations of a *number*
 * can be trilaterated; repeated observations of a band cannot narrow
 * anything below the width of the band.
 */
export function distanceBand(km: number | null): string | null {
  if (km === null) return null;
  if (km < 3) return "close by";
  if (km < 8) return "about 5 km away";
  if (km < 15) return "about 10 km away";
  if (km < 30) return "about 20 km away";
  if (km < 60) return "about 40 km away";
  if (km < 150) return "across the city";
  return "a long way from here";
}
