import { AssetRecord } from '../types';

// assets_export.json — structured assets for downstream consumption (DESIGN.md §9).
export function buildAssetsExport(assets: AssetRecord[]) {
  const paths = uniq(assets.filter((a) => a.type === 'path').map((a) => a.value));
  const apis = uniq(assets.filter((a) => a.type === 'api').map((a) => a.value));
  const params = uniq(assets.filter((a) => a.type === 'param').map((a) => a.value));
  const secrets = assets
    .filter((a) => a.type === 'secret')
    .map((a) => ({
      kind: a.secretKind,
      value: a.value,
      classification: a.classification,
      file: a.file,
      line: a.line,
    }));
  return {
    generated_by: 'JS Analyzer Agent v0.1',
    counts: { paths: paths.length, apis: apis.length, params: params.length, secrets: secrets.length },
    paths,
    apis,
    params,
    secrets,
  };
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs)).sort();
}
