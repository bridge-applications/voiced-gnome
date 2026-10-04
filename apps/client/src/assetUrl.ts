export function withAssetBase(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}
export function assetUrl(path: string): string {
  return withAssetBase(import.meta.env.BASE_URL, path);
}
