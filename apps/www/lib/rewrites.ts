type Rewrite = { source: string; destination: string };

export function zoneRewrites(basePath: string, origin: string): Rewrite[] {
  const zone = `${origin}${basePath}`;
  return [
    {
      source: `${basePath}/:path(.*)\\.segments/:segment(.*)\\.segment\\.rsc`,
      destination: `${zone}/:path`,
    },
    { source: `${basePath}\\.segments/:segment(.*)\\.segment\\.rsc`, destination: zone },
    { source: `${basePath}\\.rsc`, destination: zone },
    { source: basePath, destination: zone },
    { source: `${basePath}/:path*`, destination: `${zone}/:path*` },
    { source: `${basePath}-static/:path+`, destination: `${origin}${basePath}-static/:path+` },
  ];
}
