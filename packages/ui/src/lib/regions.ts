// The cities of the usual AWS regions. Other names are shown as they are.
const CITIES: Record<string, string> = {
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  "us-west-1": "N. California",
  "us-west-2": "Oregon",
  "ca-central-1": "Montreal",
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "eu-central-1": "Frankfurt",
  "eu-north-1": "Stockholm",
  "ap-south-1": "Mumbai",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-northeast-1": "Tokyo",
  "sa-east-1": "São Paulo",
  local: "This machine",
};

// Roughly where each region's data centres are, as [latitude, longitude].
const PLACES: Record<string, [number, number]> = {
  "us-east-1": [38.9, -77.4],
  "us-east-2": [40.0, -83.0],
  "us-west-1": [37.4, -121.9],
  "us-west-2": [45.6, -121.2],
  "ca-central-1": [45.5, -73.6],
  "eu-west-1": [53.3, -6.3],
  "eu-west-2": [51.5, -0.1],
  "eu-west-3": [48.9, 2.4],
  "eu-central-1": [50.1, 8.7],
  "eu-north-1": [59.3, 18.1],
  "ap-south-1": [19.1, 72.9],
  "ap-southeast-1": [1.4, 103.8],
  "ap-southeast-2": [-33.9, 151.2],
  "ap-northeast-1": [35.7, 139.7],
  "sa-east-1": [-23.5, -46.6],
};

/**
 * Where a region is on the map, if we know. "local" is this machine, so it is
 * placed by the browser's time zone: 15 degrees of longitude per hour.
 */
export function place(region: string): [number, number] | undefined {
  if (region === "local") return [25, -new Date().getTimezoneOffset() / 4];
  return PLACES[region];
}

const AREAS: Record<string, string> = {
  us: "United States",
  ca: "Canada",
  eu: "Europe",
  ap: "Asia Pacific",
  sa: "South America",
  me: "Middle East",
  af: "Africa",
};

/** Where a region is, such as "Frankfurt". */
export function city(region: string) {
  return CITIES[region] ?? region;
}

/** The part of the world a region is in, such as "Europe". */
export function area(region: string) {
  return AREAS[region.split("-")[0]] ?? "";
}

/** Every region we can place on the map. */
export const MAPPED_REGIONS = Object.keys(PLACES);
